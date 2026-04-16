import { BootstrapPayload } from '../contracts/bootstrap.types';

/**
 * Shared environment variables injected into every spawned agent process —
 * regardless of framework adapter. Keeps the legacy `EXAMPLE_AGENT_*` vars
 * populated for pre-0.2 workers while adding the direct-agent-auth vars
 * (`MACP_SESSION_ID`, `MACP_RUNTIME_*`) that new workers read via the
 * bootstrap file.
 */
export function buildAgentEnv(bootstrap: BootstrapPayload, framework: string): Record<string, string> {
  const cancelCb = bootstrap.cancelCallback;
  return {
    MACP_BOOTSTRAP_FILE: '',
    MACP_CONTROL_PLANE_URL: bootstrap.runtime.baseUrl,
    MACP_LOG_LEVEL: 'info',
    MACP_FRAMEWORK: framework,
    MACP_PARTICIPANT_ID: bootstrap.participant.participantId,
    MACP_RUN_ID: bootstrap.run.runId,
    MACP_SESSION_ID: bootstrap.run.sessionId ?? '',
    MACP_RUNTIME_ADDRESS: bootstrap.runtime.address ?? '',
    MACP_RUNTIME_TOKEN: bootstrap.runtime.bearerToken ?? '',
    MACP_RUNTIME_TLS: bootstrap.runtime.tls === false ? 'false' : 'true',
    MACP_RUNTIME_ALLOW_INSECURE: bootstrap.runtime.allowInsecure === true ? 'true' : 'false',
    MACP_CANCEL_CALLBACK_HOST: cancelCb?.host ?? '',
    MACP_CANCEL_CALLBACK_PORT: cancelCb ? String(cancelCb.port) : '',
    MACP_CANCEL_CALLBACK_PATH: cancelCb?.path ?? '',
    CONTROL_PLANE_BASE_URL: bootstrap.runtime.baseUrl,
    CONTROL_PLANE_API_KEY: bootstrap.runtime.apiKey ?? '',
    CONTROL_PLANE_TIMEOUT_MS: String(bootstrap.runtime.timeoutMs ?? 10000),
    EXAMPLE_AGENT_RUN_ID: bootstrap.run.runId,
    EXAMPLE_AGENT_SESSION_ID: bootstrap.run.sessionId ?? '',
    EXAMPLE_AGENT_TRACE_ID: bootstrap.run.traceId ?? '',
    EXAMPLE_AGENT_SCENARIO_REF: bootstrap.execution.scenarioRef,
    EXAMPLE_AGENT_MODE_NAME: bootstrap.execution.modeName,
    EXAMPLE_AGENT_MODE_VERSION: bootstrap.execution.modeVersion ?? '1.0.0',
    EXAMPLE_AGENT_CONFIGURATION_VERSION: bootstrap.execution.configurationVersion ?? 'config.default',
    EXAMPLE_AGENT_POLICY_VERSION: bootstrap.execution.policyVersion ?? '',
    EXAMPLE_AGENT_POLICY_HINTS_JSON: JSON.stringify(bootstrap.execution.policyHints ?? {}),
    EXAMPLE_AGENT_SESSION_TTL_MS: String(bootstrap.execution.ttlMs ?? 300000),
    EXAMPLE_AGENT_INITIATOR_PARTICIPANT_ID: bootstrap.execution.initiatorParticipantId ?? '',
    EXAMPLE_AGENT_CONTEXT_JSON: JSON.stringify(bootstrap.session.context ?? {}),
    EXAMPLE_AGENT_PARTICIPANTS_JSON: JSON.stringify(bootstrap.session.participants ?? []),
    EXAMPLE_AGENT_REF: bootstrap.participant.agentId,
    EXAMPLE_AGENT_PARTICIPANT_ID: bootstrap.participant.participantId,
    EXAMPLE_AGENT_ROLE: bootstrap.participant.role ?? '',
    EXAMPLE_AGENT_FRAMEWORK: framework,
    EXAMPLE_AGENT_TRANSPORT_IDENTITY: `agent://${bootstrap.participant.agentId}`,
    EXAMPLE_AGENT_ENTRYPOINT: ''
  };
}
