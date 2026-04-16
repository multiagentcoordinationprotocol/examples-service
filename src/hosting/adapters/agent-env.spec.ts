import { buildAgentEnv } from './agent-env';
import { BootstrapPayload } from '../contracts/bootstrap.types';

function fullBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    run: { runId: 'run-1', sessionId: 'sess-uuid-v4', traceId: 'trace-1' },
    participant: {
      participantId: 'fraud-agent',
      agentId: 'fraud-agent',
      displayName: 'Fraud Agent',
      role: 'fraud'
    },
    runtime: {
      address: 'runtime.local:50051',
      bearerToken: 'tok-fraud',
      tls: true,
      allowInsecure: false,
      baseUrl: 'http://localhost:3001',
      messageEndpoint: '/runs/run-1/messages',
      eventsEndpoint: '/runs/run-1/events',
      apiKey: 'cp-key',
      timeoutMs: 5000,
      joinMetadata: { transport: 'grpc', messageFormat: 'macp' }
    },
    execution: {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      policyVersion: 'policy.default',
      policyHints: { type: 'majority', threshold: 0.5 },
      ttlMs: 300000,
      initiatorParticipantId: 'risk-agent'
    },
    session: { context: { transactionAmount: 3200 }, participants: ['fraud-agent', 'risk-agent'] },
    agent: { manifest: {}, framework: 'langgraph' },
    cancelCallback: { host: '127.0.0.1', port: 9123, path: '/agent/cancel' },
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
        runtime: {
          ...fullBootstrap().runtime,
          address: undefined,
          bearerToken: undefined,
          tls: undefined,
          allowInsecure: undefined
        }
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
    const env = buildAgentEnv(fullBootstrap({ cancelCallback: undefined }), 'langgraph');
    expect(env.MACP_CANCEL_CALLBACK_HOST).toBe('');
    expect(env.MACP_CANCEL_CALLBACK_PORT).toBe('');
    expect(env.MACP_CANCEL_CALLBACK_PATH).toBe('');
  });

  it('serializes scenario context + participants as JSON strings for legacy worker consumers', () => {
    const env = buildAgentEnv(fullBootstrap(), 'langgraph');
    expect(JSON.parse(env.EXAMPLE_AGENT_CONTEXT_JSON)).toEqual({ transactionAmount: 3200 });
    expect(JSON.parse(env.EXAMPLE_AGENT_PARTICIPANTS_JSON)).toEqual(['fraud-agent', 'risk-agent']);
    expect(JSON.parse(env.EXAMPLE_AGENT_POLICY_HINTS_JSON)).toEqual({ type: 'majority', threshold: 0.5 });
  });

  it('stamps framework consistently across MACP_FRAMEWORK, EXAMPLE_AGENT_FRAMEWORK, and transport identity', () => {
    const env = buildAgentEnv(fullBootstrap(), 'crewai');
    expect(env.MACP_FRAMEWORK).toBe('crewai');
    expect(env.EXAMPLE_AGENT_FRAMEWORK).toBe('crewai');
    expect(env.EXAMPLE_AGENT_TRANSPORT_IDENTITY).toBe('agent://fraud-agent');
  });
});
