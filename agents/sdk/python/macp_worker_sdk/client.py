"""Control-plane HTTP client for worker processes.

Read-only observability only — envelope emission MUST go through the
`macp_sdk` client directly to the runtime (RFC-MACP-0004 §4,
RFC-MACP-0001 §5.3). The legacy `send_message()` write path has been
removed as part of ES-8 (direct-agent-auth).
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from macp_worker_sdk.bootstrap import BootstrapContext

JsonDict = Dict[str, Any]

POLICY_EVENT_TYPES = {
    'RESOLVED': 'policy.resolved',
    'COMMITMENT_EVALUATED': 'policy.commitment.evaluated',
    'DENIED': 'policy.denied',
}


def is_policy_denial(event: JsonDict) -> bool:
    """Check if an event represents a policy denial."""
    return (
        event.get('type') == POLICY_EVENT_TYPES['DENIED']
        or (
            event.get('type') == POLICY_EVENT_TYPES['COMMITMENT_EVALUATED']
            and event.get('data', {}).get('decision') == 'deny'
        )
    )


class ControlPlaneClient:
    """HTTP client for communicating with the MACP control plane from a worker."""

    def __init__(self, ctx: BootstrapContext) -> None:
        self.base_url = ctx.runtime.base_url.rstrip('/')
        self.timeout = ctx.runtime.timeout_ms / 1000.0
        api_key = (ctx.runtime.api_key or 'example-agent').strip() or 'example-agent'
        self.authorization = api_key if api_key.startswith('Bearer ') else f'Bearer {api_key}'
        self.run_id = ctx.run_id
        self.participant_id = ctx.participant_id

    def get_run(self) -> JsonDict:
        """Fetch the current run record."""
        return self._request('GET', f'/runs/{self.run_id}')

    def get_events(self, after_seq: int = 0, limit: int = 200) -> List[JsonDict]:
        """Poll for new events after a given sequence number."""
        query = urllib.parse.urlencode({'afterSeq': after_seq, 'limit': limit})
        result = self._request('GET', f'/runs/{self.run_id}/events?{query}')
        return result if isinstance(result, list) else []

    def is_terminal(self, run: Optional[JsonDict] = None) -> bool:
        """Check whether the run has reached a terminal status."""
        if run is None:
            run = self.get_run()
        return str(run.get('status', '')) in {'completed', 'failed', 'cancelled'}

    def _request(self, method: str, path: str, body: Optional[JsonDict] = None) -> Any:
        headers = {'authorization': self.authorization}
        data = None
        if body is not None:
            headers['content-type'] = 'application/json'
            data = json.dumps(body).encode('utf-8')

        request = urllib.request.Request(
            f'{self.base_url}{path}',
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = response.read().decode('utf-8')
                if not payload:
                    return None
                return json.loads(payload)
        except urllib.error.HTTPError as error:
            message = error.read().decode('utf-8', errors='replace')
            reasons: List[str] = []
            error_message = message
            try:
                error_body = json.loads(message)
                error_message = error_body.get('message', message)
                reasons = error_body.get('reasons', [])
            except (json.JSONDecodeError, TypeError):
                pass
            reasons_str = f' [reasons: {", ".join(reasons)}]' if reasons else ''
            raise RuntimeError(
                f'{method} {path} failed ({error.code}): {error_message}{reasons_str}'
            ) from error
        except urllib.error.URLError as error:
            raise RuntimeError(f'{method} {path} failed: {error.reason}') from error
