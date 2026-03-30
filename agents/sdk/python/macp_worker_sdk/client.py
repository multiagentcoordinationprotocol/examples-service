"""Control plane HTTP client for worker processes."""

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from macp_worker_sdk.bootstrap import BootstrapContext

JsonDict = Dict[str, Any]


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

    def send_message(self, body: JsonDict) -> JsonDict:
        """Send an MACP message to the run."""
        return self._request('POST', f'/runs/{self.run_id}/messages', body)

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
            raise RuntimeError(f'{method} {path} failed ({error.code}): {message}') from error
        except urllib.error.URLError as error:
            raise RuntimeError(f'{method} {path} failed: {error.reason}') from error
