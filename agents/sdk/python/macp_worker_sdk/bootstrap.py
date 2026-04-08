"""Bootstrap loader — reads the MACP_BOOTSTRAP_FILE and exposes typed context."""

import json
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

JsonDict = Dict[str, Any]


@dataclass
class RunContext:
    run_id: str
    session_id: Optional[str] = None
    trace_id: Optional[str] = None


@dataclass
class ParticipantContext:
    participant_id: str
    agent_id: str
    display_name: str
    role: str


@dataclass
class RuntimeContext:
    base_url: str
    message_endpoint: str
    events_endpoint: str
    api_key: Optional[str] = None
    timeout_ms: int = 10000
    runtime_url: Optional[str] = None
    secure: bool = False


@dataclass
class PolicyHints:
    type: str = 'none'
    description: str = ''
    threshold: float = 0.5
    veto_enabled: bool = False
    critical_severity_vetoes: bool = False
    veto_roles: List[str] = field(default_factory=list)
    veto_threshold: int = 1
    minimum_confidence: float = 0.0
    designated_roles: List[str] = field(default_factory=list)


@dataclass
class ExecutionContext:
    scenario_ref: str
    mode_name: str
    mode_version: str
    configuration_version: str
    policy_version: Optional[str] = None
    policy_hints: Optional[PolicyHints] = None
    ttl_ms: int = 300000
    initiator_participant_id: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    requester: Optional[str] = None


@dataclass
class SessionContext:
    context: JsonDict = field(default_factory=dict)
    participants: List[str] = field(default_factory=list)
    metadata: JsonDict = field(default_factory=dict)


@dataclass
class AgentContext:
    manifest: JsonDict = field(default_factory=dict)
    framework: str = 'custom'
    framework_config: JsonDict = field(default_factory=dict)


@dataclass
class KickoffContext:
    message_type: Optional[str] = None
    payload: JsonDict = field(default_factory=dict)


@dataclass
class BootstrapContext:
    """Full bootstrap context loaded from the bootstrap file."""
    run: RunContext
    participant: ParticipantContext
    runtime: RuntimeContext
    execution: ExecutionContext
    session: SessionContext
    agent: AgentContext
    kickoff: Optional[KickoffContext] = None
    raw: JsonDict = field(default_factory=dict)

    @property
    def run_id(self) -> str:
        return self.run.run_id

    @property
    def participant_id(self) -> str:
        return self.participant.participant_id

    @property
    def framework(self) -> str:
        return self.agent.framework

    @property
    def role(self) -> str:
        return self.participant.role

    @property
    def policy_hints(self) -> Optional[PolicyHints]:
        return self.execution.policy_hints

    @property
    def session_context(self) -> JsonDict:
        return self.session.context

    @property
    def participants(self) -> List[str]:
        return self.session.participants

    def specialist_recipients(self) -> List[str]:
        """Other participants (excluding self)."""
        if self.execution.initiator_participant_id:
            return [self.execution.initiator_participant_id]
        return [p for p in self.participants if p != self.participant_id]


def load_bootstrap(filepath: Optional[str] = None) -> BootstrapContext:
    """Load bootstrap context from file (MACP_BOOTSTRAP_FILE env var or explicit path)."""
    path = filepath or os.getenv('MACP_BOOTSTRAP_FILE')
    if not path:
        raise RuntimeError(
            'MACP_BOOTSTRAP_FILE environment variable is not set and no filepath was provided'
        )

    with open(path, 'r') as f:
        raw = json.load(f)

    run_data = raw.get('run', {})
    run = RunContext(
        run_id=run_data.get('runId', ''),
        session_id=run_data.get('sessionId'),
        trace_id=run_data.get('traceId'),
    )

    participant_data = raw.get('participant', {})
    participant = ParticipantContext(
        participant_id=participant_data.get('participantId', ''),
        agent_id=participant_data.get('agentId', ''),
        display_name=participant_data.get('displayName', ''),
        role=participant_data.get('role', ''),
    )

    runtime_data = raw.get('runtime', {})
    runtime = RuntimeContext(
        base_url=runtime_data.get('baseUrl', ''),
        message_endpoint=runtime_data.get('messageEndpoint', ''),
        events_endpoint=runtime_data.get('eventsEndpoint', ''),
        api_key=runtime_data.get('apiKey'),
        timeout_ms=runtime_data.get('timeoutMs', 10000),
        runtime_url=runtime_data.get('runtimeUrl'),
        secure=bool(runtime_data.get('secure', False)),
    )

    execution_data = raw.get('execution', {})
    hints_data = execution_data.get('policyHints')
    policy_hints = None
    if isinstance(hints_data, dict):
        policy_hints = PolicyHints(
            type=hints_data.get('type', 'none'),
            description=hints_data.get('description', ''),
            threshold=float(hints_data.get('threshold', 0.5)),
            veto_enabled=bool(hints_data.get('vetoEnabled', False)),
            critical_severity_vetoes=bool(hints_data.get('criticalSeverityVetoes', False)),
            veto_roles=hints_data.get('vetoRoles', []),
            veto_threshold=int(hints_data.get('vetoThreshold', 1)),
            minimum_confidence=float(hints_data.get('minimumConfidence', 0.0)),
            designated_roles=hints_data.get('designatedRoles', []),
        )
    execution = ExecutionContext(
        scenario_ref=execution_data.get('scenarioRef', ''),
        mode_name=execution_data.get('modeName', ''),
        mode_version=execution_data.get('modeVersion', ''),
        configuration_version=execution_data.get('configurationVersion', ''),
        policy_version=execution_data.get('policyVersion'),
        policy_hints=policy_hints,
        ttl_ms=execution_data.get('ttlMs', 300000),
        initiator_participant_id=execution_data.get('initiatorParticipantId'),
        tags=execution_data.get('tags', []),
        requester=execution_data.get('requester'),
    )

    session_data = raw.get('session', {})
    session = SessionContext(
        context=session_data.get('context', {}),
        participants=session_data.get('participants', []),
        metadata=session_data.get('metadata', {}),
    )

    agent_data = raw.get('agent', {})
    agent = AgentContext(
        manifest=agent_data.get('manifest', {}),
        framework=agent_data.get('framework', 'custom'),
        framework_config=agent_data.get('frameworkConfig', {}),
    )

    kickoff = None
    kickoff_data = raw.get('kickoff')
    if kickoff_data:
        kickoff = KickoffContext(
            message_type=kickoff_data.get('messageType'),
            payload=kickoff_data.get('payload', {}),
        )

    return BootstrapContext(
        run=run,
        participant=participant,
        runtime=runtime,
        execution=execution,
        session=session,
        agent=agent,
        kickoff=kickoff,
        raw=raw,
    )


def log_agent(message: str, **details: Any) -> None:
    """Structured JSON log line to stdout."""
    payload: JsonDict = {
        'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'message': message,
    }
    payload.update(details)
    print(json.dumps(payload), flush=True)
