"""Participant abstraction — event loop with handler registration for MACP workers.

The participant polls the control-plane (read-only observability) for events
and dispatches to user-registered handlers. Envelope emission is routed
through a ``macp_sdk.DecisionSession`` held over a direct gRPC channel to the
MACP runtime (RFC-MACP-0004 §4, RFC-MACP-0001 §5.3). The legacy HTTP-bridge
write path has been removed as part of ES-8.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

from macp_worker_sdk.bootstrap import BootstrapContext, load_bootstrap, log_agent
from macp_worker_sdk.client import ControlPlaneClient
from macp_worker_sdk.message_builder import (
    extract_message_type,
    extract_payload,
    extract_proposal_id,
    extract_sender,
)

if TYPE_CHECKING:  # pragma: no cover
    from macp_sdk import DecisionSession  # type: ignore

JsonDict = Dict[str, Any]


class Actions:
    """Envelope-emission facade backed by ``macp_sdk.DecisionSession``.

    The class itself is thin: each method calls the corresponding mode-helper
    on the session (``evaluate``, ``raise_objection``, ``vote``, ``commit``).
    The session owns the gRPC channel, the sender-identity guard, and envelope
    construction.
    """

    def __init__(self, session: "DecisionSession") -> None:
        self._session = session

    def evaluate(
        self,
        proposal_id: str,
        recommendation: str,
        confidence: float,
        reason: str,
        **_ignored: Any,
    ) -> None:
        self._session.evaluate(
            proposal_id,
            recommendation,
            confidence=confidence,
            reason=reason,
        )

    def object(
        self,
        proposal_id: str,
        reason: str,
        severity: str = 'high',
        **_ignored: Any,
    ) -> None:
        self._session.raise_objection(
            proposal_id,
            reason=reason,
            severity=severity,
        )

    def vote(
        self,
        proposal_id: str,
        vote: str,
        reason: str,
        **_ignored: Any,
    ) -> None:
        self._session.vote(proposal_id, vote, reason=reason)

    def commit(
        self,
        proposal_id: str,
        action: str,
        reason: str,
        authority_scope: str = 'transaction_review',
        **_ignored: Any,
    ) -> None:
        self._session.commit(
            action=action,
            authority_scope=authority_scope,
            reason=reason,
            commitment_id=f'{proposal_id}-final',
        )


@dataclass
class MessageContext:
    """Context passed to each handler invocation."""
    event: JsonDict
    payload: JsonDict
    proposal_id: Optional[str]
    sender: Optional[str]
    bootstrap: BootstrapContext
    actions: Actions


Handler = Callable[[MessageContext], None]

_EVENT_TYPE_MAP = {
    'proposal.created': 'Proposal',
    'decision.finalized': 'Finalized',
}


class Participant:
    """Event-driven participant with handler registration and poll loop.

    The participant owns:

    * a read-only ``ControlPlaneClient`` used to poll run state + events,
    * a ``macp_sdk.MacpClient`` gRPC channel to the runtime,
    * a ``DecisionSession`` bound to the run's pre-allocated sessionId,
    * an optional cancel-callback HTTP server (RFC-0001 §7.2 Option A).
    """

    def __init__(
        self,
        bootstrap: BootstrapContext,
        *,
        session: Optional["DecisionSession"] = None,
        client: Optional[Any] = None,
    ) -> None:
        self.bootstrap = bootstrap
        self._cp = ControlPlaneClient(bootstrap)
        self._client = client
        self._session = session if session is not None else self._build_session()
        self._handlers: Dict[str, List[Handler]] = {}
        self._terminal_handler: Optional[Callable[[JsonDict], None]] = None
        self._actions = Actions(self._session)
        self._finalized = False
        self._cancel_server: Optional[threading.Thread] = None
        self._cancel_httpd: Optional[Any] = None

    def _build_session(self) -> "DecisionSession":
        runtime = self.bootstrap.runtime
        if not runtime.has_direct_identity:
            raise RuntimeError(
                'Direct-agent-auth requires bootstrap.runtime.address + bootstrap.runtime.bearerToken. '
                'Populate EXAMPLES_SERVICE_AGENT_TOKENS_JSON and MACP_RUNTIME_ADDRESS on the examples-service.'
            )
        if not self.bootstrap.run.session_id:
            raise RuntimeError(
                'Direct-agent-auth requires bootstrap.run.sessionId; examples-service must pre-allocate it.'
            )

        from macp_sdk import AuthConfig, DecisionSession, MacpClient  # lazy import

        client = MacpClient(
            target=runtime.address,
            secure=runtime.tls,
            allow_insecure=runtime.allow_insecure,
            auth=AuthConfig.for_bearer(
                runtime.bearer_token,
                expected_sender=self.bootstrap.participant_id,
            ),
        )
        try:
            client.initialize()
        except Exception as exc:  # pragma: no cover — smoke-tested via integration
            log_agent('runtime initialize failed', error=str(exc))
            raise

        self._client = client
        return DecisionSession(
            client,
            session_id=self.bootstrap.run.session_id,
            mode_version=self.bootstrap.execution.mode_version,
            configuration_version=self.bootstrap.execution.configuration_version,
            policy_version=self.bootstrap.execution.policy_version or '',
        )

    def on(self, event_type: str) -> Callable[[Handler], Handler]:
        def decorator(fn: Handler) -> Handler:
            self._handlers.setdefault(event_type, []).append(fn)
            return fn
        return decorator

    def on_terminal(self, fn: Callable[[JsonDict], None]) -> None:
        self._terminal_handler = fn

    def run(self) -> None:
        """Poll loop: fetch events, dispatch to handlers, exit on terminal or deadline."""
        self._emit_initiator_envelopes()
        self._start_cancel_callback()

        after_seq = 0
        ttl_seconds = self.bootstrap.execution.ttl_ms / 1000.0
        deadline = time.time() + min(max(ttl_seconds + 15.0, 60.0), 420.0)

        log_agent(
            'participant started',
            participantId=self.bootstrap.participant_id,
            runId=self.bootstrap.run_id,
            sessionId=self.bootstrap.run.session_id or '',
            framework=self.bootstrap.framework,
            role=self.bootstrap.role,
            initiator=self.bootstrap.is_initiator,
        )

        try:
            while time.time() < deadline:
                if self._finalized:
                    return

                run = self._cp.get_run()
                if self._cp.is_terminal(run):
                    log_agent('run reached terminal status', status=run.get('status'))
                    if self._terminal_handler:
                        self._terminal_handler(run)
                    return

                for event in self._cp.get_events(after_seq, 200):
                    after_seq = max(after_seq, int(event.get('seq', 0) or 0))
                    self._dispatch(event)
                    if self._finalized:
                        return

                time.sleep(0.75)
        finally:
            self._stop_cancel_callback()
            if self._client is not None:
                try:
                    self._client.close()
                except Exception:  # pragma: no cover — best-effort cleanup
                    pass

        log_agent('participant timed out', participantId=self.bootstrap.participant_id)

    def stop(self) -> None:
        self._finalized = True

    def _dispatch(self, event: JsonDict) -> None:
        event_type = event.get('type', '')
        handler_key = _EVENT_TYPE_MAP.get(event_type)

        if handler_key is None and event_type == 'proposal.updated':
            handler_key = extract_message_type(event)

        if handler_key is None and event_type in ('message.sent', 'message.received'):
            handler_key = extract_message_type(event)

        if handler_key is None:
            return

        handlers = self._handlers.get(handler_key, [])
        if not handlers:
            return

        ctx = MessageContext(
            event=event,
            payload=extract_payload(event),
            proposal_id=extract_proposal_id(event),
            sender=extract_sender(event),
            bootstrap=self.bootstrap,
            actions=self._actions,
        )

        for handler in handlers:
            handler(ctx)

    def _emit_initiator_envelopes(self) -> None:
        if not self.bootstrap.is_initiator or self.bootstrap.initiator is None:
            return
        ss = self.bootstrap.initiator.session_start
        try:
            self._session.start(
                intent=ss.intent,
                participants=list(ss.participants),
                ttl_ms=ss.ttl_ms,
                context=ss.context if ss.context else None,
            )
            log_agent('SessionStart emitted', sessionId=self.bootstrap.run.session_id)
        except Exception as exc:
            log_agent('SessionStart failed', error=str(exc))
            raise

        kickoff = self.bootstrap.initiator.kickoff
        if kickoff is None:
            return
        if kickoff.message_type == 'Proposal':
            payload = kickoff.payload or {}
            proposal_id = str(
                payload.get('proposalId')
                or payload.get('proposal_id')
                or f'{self.bootstrap.run_id}-kickoff'
            )
            option = str(payload.get('option') or 'decide')
            rationale = str(payload.get('rationale') or '')
            self._session.propose(proposal_id, option, rationale=rationale)
            log_agent('kickoff proposal emitted', proposalId=proposal_id)
        else:
            log_agent(
                'kickoff messageType not supported by initiator',
                messageType=kickoff.message_type or '',
            )

    def _start_cancel_callback(self) -> None:
        cc = self.bootstrap.cancel_callback
        if cc is None or not cc.host:
            return

        import http.server
        import json as _json
        import socketserver

        session = self._session
        bootstrap = self.bootstrap
        self_ref = self

        class CancelHandler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 — http.server API
                if not self.path.startswith(cc.path):
                    self.send_response(404)
                    self.end_headers()
                    return
                length = int(self.headers.get('content-length') or '0')
                raw = self.rfile.read(length) if length else b''
                reason = 'cancelled by control plane'
                try:
                    body = _json.loads(raw.decode('utf-8')) if raw else {}
                    if isinstance(body, dict) and isinstance(body.get('reason'), str):
                        reason = body['reason']
                except Exception:
                    pass
                try:
                    session.cancel(reason=reason)
                    log_agent(
                        'cancel forwarded to runtime',
                        sessionId=bootstrap.run.session_id or '',
                        reason=reason,
                    )
                    self_ref._finalized = True
                    self.send_response(202)
                    self.send_header('content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')
                except Exception as exc:
                    log_agent('cancel forward failed', error=str(exc))
                    self.send_response(500)
                    self.send_header('content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(_json.dumps({'error': str(exc)}).encode('utf-8'))

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                # Silence default stderr log; we log via log_agent().
                return

        class _ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
            daemon_threads = True
            allow_reuse_address = True

        httpd = _ThreadingServer((cc.host, cc.port), CancelHandler)
        self._cancel_httpd = httpd
        thread = threading.Thread(target=httpd.serve_forever, daemon=True, name='macp-cancel-cb')
        thread.start()
        self._cancel_server = thread
        port = httpd.server_address[1]
        log_agent('cancel callback listening', address=f'http://{cc.host}:{port}{cc.path}')

    def _stop_cancel_callback(self) -> None:
        if self._cancel_httpd is not None:
            try:
                self._cancel_httpd.shutdown()
                self._cancel_httpd.server_close()
            except Exception:  # pragma: no cover
                pass
            self._cancel_httpd = None
        self._cancel_server = None


def from_bootstrap(filepath: Optional[str] = None) -> Participant:
    """Factory: load bootstrap and create a Participant."""
    bootstrap = load_bootstrap(filepath)
    return Participant(bootstrap)
