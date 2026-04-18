import { buildAgentEnv } from './agent-env';
import { BootstrapPayload } from '../contracts/bootstrap.types';

function fullBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    participant_id: 'fraud-agent',
    session_id: 'sess-uuid-v4',
    mode: 'macp.mode.decision.v1',
    runtime_url: 'runtime.local:50051',
    auth_token: 'tok-fraud',
    secure: true,
    allow_insecure: false,
    participants: ['fraud-agent', 'risk-agent'],
    mode_version: '1.0.0',
    configuration_version: 'config.default',
    policy_version: 'policy.default',
    cancel_callback: { host: '127.0.0.1', port: 9123, path: '/agent/cancel' },
    metadata: {
      run_id: 'run-1',
      trace_id: 'trace-1',
      scenario_ref: 'fraud/high-value-new-device@1.0.0',
      role: 'fraud',
      framework: 'langgraph',
      agent_ref: 'fraud-agent',
      policy_hints: { type: 'majority', threshold: 0.5 },
      session_context: { transactionAmount: 3200 }
    },
    ...overrides
  };
}

describe('buildAgentEnv', () => {
  it('emits direct-agent-auth env vars when bootstrap.runtime has token + address', () => {
    const env = buildAgentEnv(fullBootstrap(), 'langgraph');
    expect(env.MACP_RUNTIME_ADDRESS).toBe('runtime.local:50051');
    expect(env.MACP_RUNTIME_TOKEN).toBe('tok-fraud');
    expect(env.MACP_RUNTIME_TLS).toBe('true');
    expect(env.MACP_RUNTIME_ALLOW_INSECURE).toBe('false');
    expect(env.MACP_SESSION_ID).toBe('sess-uuid-v4');
  });

  it('emits empty strings for runtime creds when direct-agent-auth is not configured', () => {
    const env = buildAgentEnv(
      fullBootstrap({
        runtime_url: undefined,
        auth_token: undefined,
        secure: undefined,
        allow_insecure: undefined
      }),
      'langgraph'
    );
    expect(env.MACP_RUNTIME_ADDRESS).toBe('');
    expect(env.MACP_RUNTIME_TOKEN).toBe('');
    // Default to the safe RFC-MACP-0006 §3 side when tls is unset.
    expect(env.MACP_RUNTIME_TLS).toBe('true');
    expect(env.MACP_RUNTIME_ALLOW_INSECURE).toBe('false');
  });

  it('propagates the cancel-callback tuple into dedicated env vars', () => {
    const env = buildAgentEnv(fullBootstrap(), 'langgraph');
    expect(env.MACP_CANCEL_CALLBACK_HOST).toBe('127.0.0.1');
    expect(env.MACP_CANCEL_CALLBACK_PORT).toBe('9123');
    expect(env.MACP_CANCEL_CALLBACK_PATH).toBe('/agent/cancel');
  });

  it('leaves cancel-callback vars empty when no callback is configured', () => {
    const env = buildAgentEnv(fullBootstrap({ cancel_callback: undefined }), 'langgraph');
    expect(env.MACP_CANCEL_CALLBACK_HOST).toBe('');
    expect(env.MACP_CANCEL_CALLBACK_PORT).toBe('');
    expect(env.MACP_CANCEL_CALLBACK_PATH).toBe('');
  });

  it('stamps MACP_FRAMEWORK from the framework argument', () => {
    const env = buildAgentEnv(fullBootstrap(), 'crewai');
    expect(env.MACP_FRAMEWORK).toBe('crewai');
  });
});
