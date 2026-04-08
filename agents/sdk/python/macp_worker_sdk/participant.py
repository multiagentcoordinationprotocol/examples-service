"""Participant abstraction — event loop with handler registration for MACP workers."""

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from macp_worker_sdk.bootstrap import BootstrapContext, load_bootstrap, log_agent
from macp_worker_sdk.client import ControlPlaneClient
from macp_worker_sdk.message_builder import (
    MacpMessageBuilder,
    extract_message_type,
    extract_payload,
    extract_proposal_id,
    extract_sender,
)

JsonDict = Dict[str, Any]


class Actions:
    """Convenience wrapper for sending MACP messages from a handler."""

    def __init__(
        self,
        client: ControlPlaneClient,
        builder: MacpMessageBuilder,
        recipients: List[str],
    ) -> None:
        self._client = client
        self._builder = builder
        self._recipients = recipients

    def evaluate(
        self,
        proposal_id: str,
        recommendation: str,
        confidence: float,
        reason: str,
        recipients: Optional[List[str]] = None,
    ) -> None:
        msg = self._builder.evaluation(proposal_id, recommendation, confidence, reason, recipients or self._recipients)
        self._client.send_message(msg)

    def object(
        self,
        proposal_id: str,
        reason: str,
        severity: str = 'high',
        recipients: Optional[List[str]] = None,
    ) -> None:
        msg = self._builder.objection(proposal_id, reason, severity, recipients or self._recipients)
        self._client.send_message(msg)

    def vote(
        self,
        proposal_id: str,
        vote: str,
        reason: str,
        recipients: Optional[List[str]] = None,
    ) -> None:
        msg = self._builder.vote(proposal_id, vote, reason, recipients or self._recipients)
        self._client.send_message(msg)

    def commit(
        self,
        proposal_id: str,
        action: str,
        reason: str,
        recipients: Optional[List[str]] = None,
    ) -> None:
        ctx = self._builder
        msg = ctx.commitment(
            proposal_id,
            action,
            reason,
            mode_version=self._builder_execution.get('modeVersion', ''),
            policy_version=self._builder_execution.get('policyVersion', ''),
            configuration_version=self._builder_execution.get('configurationVersion', ''),
            recipients=recipients or self._recipients,
        )
        self._client.send_message(msg)

    def _set_execution(self, execution: JsonDict) -> None:
        self._builder_execution = execution


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

# Maps event types to handler keys
_EVENT_TYPE_MAP = {
    'proposal.created': 'Proposal',
    'decision.finalized': 'Finalized',
}


class Participant:
    """Event-driven participant with handler registration and poll loop."""

    def __init__(self, bootstrap: BootstrapContext) -> None:
        self.bootstrap = bootstrap
        self._client = ControlPlaneClient(bootstrap)
        self._builder = MacpMessageBuilder(
            run_id=bootstrap.run_id,
            participant_id=bootstrap.participant_id,
            framework=bootstrap.framework,
            agent_ref=bootstrap.participant.agent_id,
        )
        self._handlers: Dict[str, List[Handler]] = {}
        self._terminal_handler: Optional[Callable[[JsonDict], None]] = None

        others = [p for p in bootstrap.participants if p != bootstrap.participant_id]
        self._actions = Actions(self._client, self._builder, others)
        self._actions._set_execution({
            'modeVersion': bootstrap.execution.mode_version,
            'policyVersion': bootstrap.execution.policy_version or '',
            'configurationVersion': bootstrap.execution.configuration_version,
        })

        self._finalized = False

    def on(self, event_type: str) -> Callable[[Handler], Handler]:
        """Decorator to register a handler for an event type.

        Supported keys: 'Proposal', 'Evaluation', 'Objection', 'Vote', 'Commitment', 'Finalized'
        """
        def decorator(fn: Handler) -> Handler:
            self._handlers.setdefault(event_type, []).append(fn)
            return fn
        return decorator

    def on_terminal(self, fn: Callable[[JsonDict], None]) -> None:
        """Register a handler called when the run reaches terminal status."""
        self._terminal_handler = fn

    def run(self) -> None:
        """Poll loop: fetch events, dispatch to handlers, exit on terminal or deadline."""
        after_seq = 0
        ttl_seconds = self.bootstrap.execution.ttl_ms / 1000.0
        deadline = time.time() + min(max(ttl_seconds + 15.0, 60.0), 420.0)

        log_agent(
            'participant started',
            participantId=self.bootstrap.participant_id,
            runId=self.bootstrap.run_id,
            framework=self.bootstrap.framework,
            role=self.bootstrap.role,
        )

        while time.time() < deadline:
            if self._finalized:
                return

            run = self._client.get_run()
            if self._client.is_terminal(run):
                log_agent('run reached terminal status', status=run.get('status'))
                if self._terminal_handler:
                    self._terminal_handler(run)
                return

            for event in self._client.get_events(after_seq, 200):
                after_seq = max(after_seq, int(event.get('seq', 0) or 0))
                self._dispatch(event)
                if self._finalized:
                    return

            time.sleep(0.75)

        log_agent('participant timed out', participantId=self.bootstrap.participant_id)

    def stop(self) -> None:
        """Signal the poll loop to exit after the current cycle."""
        self._finalized = True

    def _dispatch(self, event: JsonDict) -> None:
        event_type = event.get('type', '')
        handler_key = _EVENT_TYPE_MAP.get(event_type)

        if handler_key is None and event_type == 'proposal.updated':
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


def from_bootstrap(filepath: Optional[str] = None) -> Participant:
    """Factory: load bootstrap and create a Participant."""
    bootstrap = load_bootstrap(filepath)
    return Participant(bootstrap)
