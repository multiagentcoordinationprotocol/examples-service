import { BootstrapPayload } from '../contracts/bootstrap.types';

/**
 * Shared environment variables injected into every spawned agent process.
 * The primary mechanism is the `MACP_BOOTSTRAP_FILE` JSON file — these env
 * vars provide convenience access for agents that prefer env-based config.
 */
export function buildAgentEnv(bootstrap: BootstrapPayload, framework: string): Record<string, string> {
  const cancelCb = bootstrap.cancel_callback;
  const meta = bootstrap.metadata ?? {};
  return {
    MACP_BOOTSTRAP_FILE: '',
    MACP_LOG_LEVEL: 'info',
    MACP_FRAMEWORK: framework,
    MACP_PARTICIPANT_ID: bootstrap.participant_id,
    MACP_RUN_ID: meta.run_id ?? '',
    MACP_SESSION_ID: bootstrap.session_id ?? '',
    MACP_RUNTIME_ADDRESS: bootstrap.runtime_url ?? '',
    MACP_RUNTIME_TOKEN: bootstrap.auth_token ?? '',
    MACP_RUNTIME_TLS: bootstrap.secure === false ? 'false' : 'true',
    MACP_RUNTIME_ALLOW_INSECURE: bootstrap.allow_insecure === true ? 'true' : 'false',
    MACP_CANCEL_CALLBACK_HOST: cancelCb?.host ?? '',
    MACP_CANCEL_CALLBACK_PORT: cancelCb ? String(cancelCb.port) : '',
    MACP_CANCEL_CALLBACK_PATH: cancelCb?.path ?? ''
  };
}
