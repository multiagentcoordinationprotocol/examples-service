#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

JsonDict = Dict[str, Any]


def read_env(name: str, default: Optional[str] = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


class AgentRuntimeContext:
    def __init__(self) -> None:
        self.run_id = read_env('EXAMPLE_AGENT_RUN_ID')
        self.trace_id = os.getenv('EXAMPLE_AGENT_TRACE_ID', '')
        self.scenario_ref = read_env('EXAMPLE_AGENT_SCENARIO_REF')
        self.mode_name = read_env('EXAMPLE_AGENT_MODE_NAME')
        self.mode_version = read_env('EXAMPLE_AGENT_MODE_VERSION', '1.0.0')
        self.configuration_version = read_env('EXAMPLE_AGENT_CONFIGURATION_VERSION', 'config.default')
        self.policy_version = os.getenv('EXAMPLE_AGENT_POLICY_VERSION', '')
        self.ttl_ms = int(read_env('EXAMPLE_AGENT_SESSION_TTL_MS', '300000'))
        self.participant_id = read_env('EXAMPLE_AGENT_PARTICIPANT_ID')
        self.role = read_env('EXAMPLE_AGENT_ROLE')
        self.framework = read_env('EXAMPLE_AGENT_FRAMEWORK')
        self.agent_ref = read_env('EXAMPLE_AGENT_REF')
        self.initiator_participant_id = os.getenv('EXAMPLE_AGENT_INITIATOR_PARTICIPANT_ID', '')
        self.participants = self._parse_string_list(os.getenv('EXAMPLE_AGENT_PARTICIPANTS_JSON'))
        self.session_context = self._parse_json_dict(os.getenv('EXAMPLE_AGENT_CONTEXT_JSON'))

    @staticmethod
    def _parse_string_list(raw: Optional[str]) -> List[str]:
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [value for value in parsed if isinstance(value, str)]
        except json.JSONDecodeError:
            return []
        return []

    @staticmethod
    def _parse_json_dict(raw: Optional[str]) -> JsonDict:
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
        return {}


class ControlPlaneClient:
    def __init__(self) -> None:
        self.base_url = read_env('CONTROL_PLANE_BASE_URL').rstrip('/')
        self.timeout = int(read_env('CONTROL_PLANE_TIMEOUT_MS', '10000')) / 1000.0
        api_key = (os.getenv('CONTROL_PLANE_API_KEY') or 'example-agent').strip() or 'example-agent'
        self.authorization = api_key if api_key.startswith('Bearer ') else f'Bearer {api_key}'

    def get_run(self, run_id: str) -> JsonDict:
        return self._request('GET', f'/runs/{run_id}')

    def get_events(self, run_id: str, after_seq: int, limit: int = 200) -> List[JsonDict]:
        query = urllib.parse.urlencode({'afterSeq': after_seq, 'limit': limit})
        result = self._request('GET', f'/runs/{run_id}/events?{query}')
        if isinstance(result, list):
            return result
        return []

    def send_message(self, run_id: str, body: JsonDict) -> JsonDict:
        return self._request('POST', f'/runs/{run_id}/messages', body)

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
            method=method
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


def build_proto_envelope(type_name: str, value: JsonDict) -> JsonDict:
    return {
        'encoding': 'proto',
        'proto': {
            'typeName': type_name,
            'value': value,
        },
    }


def extract_payload(event: JsonDict) -> JsonDict:
    data = event.get('data') or {}
    payload = data.get('decodedPayload') or data.get('payload') or {}
    return payload if isinstance(payload, dict) else {}


def extract_proposal_id(event: JsonDict) -> Optional[str]:
    payload = extract_payload(event)
    proposal_id = payload.get('proposalId') or payload.get('proposal_id')
    if isinstance(proposal_id, str):
        return proposal_id

    subject = event.get('subject') or {}
    subject_id = subject.get('id') if isinstance(subject, dict) else None
    return subject_id if isinstance(subject_id, str) else None


def extract_sender(event: JsonDict) -> Optional[str]:
    data = event.get('data') or {}
    sender = data.get('sender')
    return sender if isinstance(sender, str) else None


def extract_message_type(event: JsonDict) -> Optional[str]:
    data = event.get('data') or {}
    message_type = data.get('messageType')
    return message_type if isinstance(message_type, str) else None


def log(message: str, **details: Any) -> None:
    payload: JsonDict = {'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'message': message}
    payload.update(details)
    print(json.dumps(payload), flush=True)


def specialist_recipients(context: AgentRuntimeContext) -> List[str]:
    if context.initiator_participant_id:
        return [context.initiator_participant_id]
    return [participant for participant in context.participants if participant != context.participant_id]


def terminal(run: JsonDict) -> bool:
    return str(run.get('status')) in {'completed', 'failed', 'cancelled'}
