import { AgentRuntimeContext, CanonicalEvent } from './control-plane-agent-client';
import { BootstrapPayload } from '../../hosting/contracts/bootstrap.types';

// ── SDK mocks ────────────────────────────────────────────────────────
const mockStart = jest.fn();
const mockPropose = jest.fn();
const mockVote = jest.fn();
const mockCommit = jest.fn();
const mockCancel = jest.fn();
const mockInitialize = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn();
const mockDecisionSessionCtor = jest.fn();
const mockMacpClientCtor = jest.fn();
const mockAuthBearer = jest.fn((token: string, opts?: unknown) => ({ token, opts }));

jest.mock('macp-sdk-typescript', () => ({
  Auth: { bearer: (...args: unknown[]) => mockAuthBearer(...(args as [string, unknown])) },
  MacpClient: jest.fn().mockImplementation((opts: unknown) => {
    mockMacpClientCtor(opts);
    return { initialize: mockInitialize, close: mockClose, auth: {} };
  }),
  DecisionSession: jest.fn().mockImplementation((client: unknown, opts: unknown) => {
    mockDecisionSessionCtor(client, opts);
    return {
      start: mockStart,
      propose: mockPropose,
      vote: mockVote,
      commit: mockCommit,
      cancel: mockCancel
    };
  })
}));

// ── worker-side mocks ────────────────────────────────────────────────
const mockGetRun = jest.fn();
const mockGetEvents = jest.fn();
const mockLogAgent = jest.fn();
const mockLoadContext = jest.fn();
const mockLoadBootstrap = jest.fn();
const mockStartCancelServer = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ address: 'http://127.0.0.1:0/agent/cancel', close: () => Promise.resolve() })
);

jest.mock('./control-plane-agent-client', () => {
  const actual = jest.requireActual('./control-plane-agent-client');
  return {
    ...actual,
    ControlPlaneAgentClient: jest.fn(() => ({
      getRun: mockGetRun,
      getEvents: mockGetEvents
    })),
    loadAgentRuntimeContext: (...args: unknown[]) => mockLoadContext(...args),
    logAgent: (...args: unknown[]) => mockLogAgent(...args)
  };
});

jest.mock('./bootstrap-loader', () => ({
  loadBootstrapPayload: () => mockLoadBootstrap(),
  hasDirectRuntimeIdentity: (b: BootstrapPayload) =>
    Boolean(b.runtime.address && b.runtime.bearerToken),
  isInitiator: (b: BootstrapPayload) => Boolean(b.initiator)
}));

jest.mock('./cancel-callback-server', () => ({
  startCancelCallbackServer: (opts: unknown) => mockStartCancelServer(opts)
}));

// ── helpers ─────────────────────────────────────────────────────────
function defaultBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    run: { runId: 'run-1', sessionId: 'sess-uuid-v4', traceId: 'trace-1' },
    participant: {
      participantId: 'risk-coordinator',
      agentId: 'risk-agent',
      displayName: 'Risk Agent',
      role: 'coordinator'
    },
    runtime: {
      address: 'runtime.local:50051',
      bearerToken: 'tok-risk',
      tls: true,
      allowInsecure: false,
      baseUrl: 'http://localhost:3001',
      messageEndpoint: '/runs/run-1/messages',
      eventsEndpoint: '/runs/run-1/events',
      timeoutMs: 10000,
      joinMetadata: { transport: 'grpc', messageFormat: 'macp' }
    },
    execution: {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      policyVersion: 'policy.fraud.majority-veto',
      policyHints: { type: 'majority', threshold: 0.5, vetoEnabled: false },
      ttlMs: 5000
    },
    session: { context: {}, participants: ['risk-coordinator', 'fraud-agent', 'compliance-agent'] },
    agent: { manifest: {}, framework: 'custom' },
    cancelCallback: { host: '127.0.0.1', port: 0, path: '/agent/cancel' },
    ...overrides
  };
}

function defaultContext(overrides?: Partial<AgentRuntimeContext>): AgentRuntimeContext {
  return {
    runId: 'run-1',
    sessionId: 'sess-uuid-v4',
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    modeName: 'macp.mode.decision.v1',
    modeVersion: '1.0.0',
    configurationVersion: 'config.default',
    policyVersion: 'policy.fraud.majority-veto',
    policyHints: { type: 'majority', threshold: 0.5, vetoEnabled: false },
    ttlMs: 5000,
    participantId: 'risk-coordinator',
    role: 'coordinator',
    framework: 'custom',
    agentRef: 'risk-agent',
    participants: ['risk-coordinator', 'fraud-agent', 'compliance-agent'],
    sessionContext: { transactionAmount: 5000 },
    ...overrides
  };
}

function proposalCreatedEvent(seq: number, proposalId: string): CanonicalEvent {
  return {
    seq,
    type: 'proposal.created',
    subject: { kind: 'proposal', id: proposalId },
    data: { decodedPayload: { proposalId } }
  };
}

function evaluationEvent(
  seq: number,
  proposalId: string,
  sender: string,
  recommendation: string,
  confidence = 0.9
): CanonicalEvent {
  return {
    seq,
    type: 'proposal.updated',
    data: {
      sender,
      messageType: 'Evaluation',
      decodedPayload: { proposalId, recommendation, confidence, reason: `${sender} analysis` }
    }
  };
}

function policyEvaluatedEvent(seq: number): CanonicalEvent {
  return { seq, type: 'policy.commitment.evaluated', data: { decision: 'allow', reasons: [] } };
}

async function runWorker(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    jest.isolateModules(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./risk-decider.worker');
      } catch (e) {
        reject(e);
      }
    });
    setTimeout(resolve, 200);
  });
}

// ── tests ───────────────────────────────────────────────────────────
describe('risk-decider.worker (direct-agent-auth)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });
    mockVote.mockResolvedValue({});
    mockCommit.mockResolvedValue({});
    mockStart.mockResolvedValue({});
    mockPropose.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startup', () => {
    it('throws when bootstrap lacks runtime.address or bearerToken', async () => {
      const bootstrap = defaultBootstrap({
        runtime: {
          ...defaultBootstrap().runtime,
          address: undefined,
          bearerToken: undefined,
          joinMetadata: { transport: 'http', messageFormat: 'macp' }
        }
      });
      mockLoadBootstrap.mockReturnValue(bootstrap);
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(500);

      expect(mockLogAgent).toHaveBeenCalledWith(
        'risk coordinator failed',
        expect.objectContaining({
          error: expect.stringContaining('bootstrap.runtime.address + bootstrap.runtime.bearerToken are required')
        })
      );
    });

    it('instantiates MacpClient with expectedSender bound to participantId', async () => {
      mockLoadBootstrap.mockReturnValue(defaultBootstrap());
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(500);

      expect(mockMacpClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          address: 'runtime.local:50051',
          secure: true,
          allowInsecure: false
        })
      );
      expect(mockAuthBearer).toHaveBeenCalledWith('tok-risk', { expectedSender: 'risk-coordinator' });
      expect(mockInitialize).toHaveBeenCalled();
    });

    it('binds DecisionSession to the pre-allocated sessionId', async () => {
      mockLoadBootstrap.mockReturnValue(defaultBootstrap());
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(500);

      expect(mockDecisionSessionCtor).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ sessionId: 'sess-uuid-v4' })
      );
    });

    it('starts cancel-callback server when bootstrap.cancelCallback is present', async () => {
      mockLoadBootstrap.mockReturnValue(defaultBootstrap());
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(500);

      expect(mockStartCancelServer).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', path: '/agent/cancel' })
      );
    });
  });

  describe('initiator branch', () => {
    it('emits SessionStart + Proposal when bootstrap.initiator is set', async () => {
      mockLoadBootstrap.mockReturnValue(
        defaultBootstrap({
          initiator: {
            sessionStart: {
              intent: 'fraud/high-value-new-device',
              participants: ['risk-coordinator', 'fraud-agent', 'compliance-agent'],
              ttlMs: 300000,
              modeVersion: '1.0.0',
              configurationVersion: 'config.default'
            },
            kickoff: {
              messageType: 'Proposal',
              payload: { proposalId: 'prop-abc', option: 'review' }
            }
          }
        })
      );
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(500);

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({ intent: 'fraud/high-value-new-device', ttlMs: 300000 })
      );
      expect(mockPropose).toHaveBeenCalledWith(
        expect.objectContaining({ proposalId: 'prop-abc', option: 'review' })
      );
    });

    it('does not emit SessionStart for non-initiator bootstrap', async () => {
      mockLoadBootstrap.mockReturnValue(defaultBootstrap());
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(500);

      expect(mockStart).not.toHaveBeenCalled();
      expect(mockPropose).not.toHaveBeenCalled();
    });
  });

  describe('quorum decision via DecisionSession', () => {
    it('calls session.vote + session.commit once quorum is met', async () => {
      mockLoadBootstrap.mockReturnValue(defaultBootstrap());
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, 'prop-1'),
          evaluationEvent(2, 'prop-1', 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, 'prop-1', 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockVote).toHaveBeenCalledWith(
        expect.objectContaining({ proposalId: 'prop-1', vote: 'APPROVE' })
      );
      expect(mockCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approve',
          commitmentId: 'prop-1-final',
          outcomePositive: true
        })
      );
    });

    it('records REJECT vote and outcomePositive=false when majority blocks', async () => {
      mockLoadBootstrap.mockReturnValue(defaultBootstrap());
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, 'prop-x'),
          evaluationEvent(2, 'prop-x', 'fraud-agent', 'BLOCK'),
          evaluationEvent(3, 'prop-x', 'compliance-agent', 'BLOCK')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockVote).toHaveBeenCalledWith(
        expect.objectContaining({ proposalId: 'prop-x', vote: 'REJECT' })
      );
      expect(mockCommit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'decline', outcomePositive: false })
      );
    });
  });

  describe('terminal + error handling', () => {
    it('exits cleanly when run reaches terminal status', async () => {
      mockLoadBootstrap.mockReturnValue(defaultBootstrap());
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockVote).not.toHaveBeenCalled();
      expect(mockCommit).not.toHaveBeenCalled();
      expect(mockLogAgent).toHaveBeenCalledWith(
        'run reached terminal status; exiting coordinator',
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('sets process.exitCode = 1 on unhandled error', async () => {
      mockLoadBootstrap.mockImplementation(() => {
        throw new Error('bootstrap missing');
      });

      const originalExitCode = process.exitCode;
      await runWorker();
      await jest.advanceTimersByTimeAsync(500);

      expect(process.exitCode).toBe(1);
      expect(mockLogAgent).toHaveBeenCalledWith(
        'risk coordinator failed',
        expect.objectContaining({ error: 'bootstrap missing' })
      );

      process.exitCode = originalExitCode;
    });
  });
});
