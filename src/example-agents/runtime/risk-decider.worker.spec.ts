import { AgentRuntimeContext, CanonicalEvent } from './control-plane-agent-client';

// ── mock setup ──────────────────────────────────────────────────────
const mockGetRun = jest.fn();
const mockGetEvents = jest.fn();
const mockSendMessage = jest.fn();
const mockLogAgent = jest.fn();
const mockLoadContext = jest.fn();

jest.mock('./control-plane-agent-client', () => {
  const actual = jest.requireActual('./control-plane-agent-client');
  return {
    ...actual,
    ControlPlaneAgentClient: jest.fn(() => ({
      getRun: mockGetRun,
      getEvents: mockGetEvents,
      sendMessage: mockSendMessage
    })),
    loadAgentRuntimeContext: (...args: unknown[]) => mockLoadContext(...args),
    logAgent: (...args: unknown[]) => mockLogAgent(...args)
  };
});

// ── helpers ─────────────────────────────────────────────────────────
function defaultContext(overrides?: Partial<AgentRuntimeContext>): AgentRuntimeContext {
  return {
    runId: 'run-1',
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

function objectionEvent(seq: number, proposalId: string, sender: string, severity: string): CanonicalEvent {
  return {
    seq,
    type: 'proposal.updated',
    data: {
      sender,
      messageType: 'Objection',
      decodedPayload: { proposalId, severity, reason: `${sender} objection` }
    }
  };
}

function policyEvaluatedEvent(seq: number): CanonicalEvent {
  return { seq, type: 'policy.commitment.evaluated', data: { decision: 'allow', reasons: [] } };
}

function decisionFinalizedEvent(seq: number): CanonicalEvent {
  return { seq, type: 'decision.finalized' };
}

// ── run the worker ──────────────────────────────────────────────────
async function runWorker(): Promise<void> {
  // The worker calls main() at module scope via `void main().catch(...)`.
  // We re-require it per test; jest.isolateModules ensures a fresh import.
  return new Promise<void>((resolve, reject) => {
    jest.isolateModules(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./risk-decider.worker');
      } catch (e) {
        reject(e);
      }
    });
    // Give the async main() time to run through its event loop
    setTimeout(resolve, 200);
  });
}

// ── tests ───────────────────────────────────────────────────────────
describe('risk-decider.worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });
    mockSendMessage.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('proposal lifecycle', () => {
    it('exits when run reaches terminal status', async () => {
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockGetRun).toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockLogAgent).toHaveBeenCalledWith(
        'run reached terminal status; exiting coordinator',
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('exits on decision.finalized event', async () => {
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents.mockResolvedValue([decisionFinalizedEvent(1)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockLogAgent).toHaveBeenCalledWith(
        'decision already finalized; exiting coordinator',
        expect.objectContaining({ seq: 1 })
      );
    });

    it('captures proposalId from proposal.created event', async () => {
      const proposalId = 'prop-abc';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([proposalCreatedEvent(1, proposalId)])
        .mockResolvedValueOnce([
          evaluationEvent(2, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        // post-commitment: return policy evaluation
        .mockResolvedValue([policyEvaluatedEvent(10)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockLogAgent).toHaveBeenCalledWith('proposal observed', expect.objectContaining({ proposalId }));
    });
  });

  describe('signal collection', () => {
    it('ignores signals from own participantId', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'risk-coordinator', 'APPROVE'),
          evaluationEvent(3, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(4, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      // Should send messages because quorum is met from 2 specialist signals (not 3 — own signal ignored)
      expect(mockSendMessage).toHaveBeenCalled();
      const voteCall = mockSendMessage.mock.calls[0][1];
      expect(voteCall.from).toBe('risk-coordinator');
    });

    it('ignores events for non-matching proposalId', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, 'other-proposal', 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(4, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      // The event for 'other-proposal' should be ignored, quorum still met with 2 matching signals
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  describe('quorum and decision', () => {
    it('sends Vote then Commitment when quorum is met', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      // First call: Vote message
      const [voteRunId, voteBody] = mockSendMessage.mock.calls[0];
      expect(voteRunId).toBe('run-1');
      expect(voteBody.messageType).toBe('Vote');
      expect(voteBody.from).toBe('risk-coordinator');
      expect(voteBody.payloadEnvelope.proto.value.proposal_id).toBe(proposalId);
      expect(voteBody.payloadEnvelope.proto.value.vote).toBe('approve');

      // Second call: Commitment message
      const [commitRunId, commitBody] = mockSendMessage.mock.calls[1];
      expect(commitRunId).toBe('run-1');
      expect(commitBody.messageType).toBe('Commitment');
      expect(commitBody.payloadEnvelope.proto.value.action).toBe('approve');
      expect(commitBody.payloadEnvelope.proto.value.outcome_positive).toBe(true);
    });

    it('sends decline commitment with outcome_positive=false on rejection', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'fraud-agent', 'BLOCK'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'BLOCK')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      const commitBody = mockSendMessage.mock.calls[1][1];
      expect(commitBody.payloadEnvelope.proto.value.action).toBe('decline');
      expect(commitBody.payloadEnvelope.proto.value.outcome_positive).toBe(false);
    });

    it('includes policy metadata in commitment payload', async () => {
      const proposalId = 'prop-1';
      const ctx = defaultContext({
        policyVersion: 'policy.fraud.unanimous',
        policyHints: {
          type: 'majority',
          threshold: 0.5,
          designatedRoles: ['risk', 'compliance'],
          vetoThreshold: 2,
          minimumConfidence: 0.7
        }
      });
      mockLoadContext.mockReturnValue(ctx);
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      const commitPayload = mockSendMessage.mock.calls[1][1].payloadEnvelope.proto.value;
      expect(commitPayload.policy_version).toBe('policy.fraud.unanimous');
      expect(commitPayload.designated_roles).toEqual(['risk', 'compliance']);
      expect(commitPayload.veto_threshold).toBe(2);
      expect(commitPayload.minimum_confidence).toBe(0.7);
    });

    it('sends to all recipients except self', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      const voteBody = mockSendMessage.mock.calls[0][1];
      expect(voteBody.to).toEqual(['fraud-agent', 'compliance-agent']);
    });
  });

  describe('policy evaluation wait', () => {
    it('waits for policy.commitment.evaluated event after commitment', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        // First poll after commitment: no policy event yet
        .mockResolvedValueOnce([])
        // Second poll: policy evaluation arrives
        .mockResolvedValueOnce([policyEvaluatedEvent(10)])
        .mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockLogAgent).toHaveBeenCalledWith(
        'policy evaluation received',
        expect.objectContaining({ type: 'policy.commitment.evaluated' })
      );
    });

    it('accepts policy.denied event', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValueOnce([{ seq: 10, type: 'policy.denied', data: { decision: 'deny', reasons: ['blocked'] } }])
        .mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockLogAgent).toHaveBeenCalledWith(
        'policy evaluation received',
        expect.objectContaining({ type: 'policy.denied' })
      );
    });

    it('accepts decision.finalized event during policy wait', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          evaluationEvent(2, proposalId, 'fraud-agent', 'APPROVE'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValueOnce([decisionFinalizedEvent(10)])
        .mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      expect(mockLogAgent).toHaveBeenCalledWith('decision finalized', expect.objectContaining({ seq: 10 }));
    });
  });

  describe('objection handling', () => {
    it('collects Objection signals and includes them in decision', async () => {
      const proposalId = 'prop-1';
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'active' });
      mockGetEvents
        .mockResolvedValueOnce([
          proposalCreatedEvent(1, proposalId),
          objectionEvent(2, proposalId, 'fraud-agent', 'high'),
          evaluationEvent(3, proposalId, 'compliance-agent', 'APPROVE')
        ])
        .mockResolvedValue([policyEvaluatedEvent(20)]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(10000);

      // With majority policy (vetoEnabled=false), 1 objection + 1 approve
      // approval rate = 1/2 = 50% >= 50% threshold -> approve
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      const commitPayload = mockSendMessage.mock.calls[1][1].payloadEnvelope.proto.value;
      expect(commitPayload.action).toBe('approve');
    });
  });

  describe('error handling', () => {
    it('sets process.exitCode = 1 on error', async () => {
      mockLoadContext.mockImplementation(() => {
        throw new Error('env var missing');
      });

      const originalExitCode = process.exitCode;
      await runWorker();
      await jest.advanceTimersByTimeAsync(1000);

      expect(process.exitCode).toBe(1);
      expect(mockLogAgent).toHaveBeenCalledWith(
        'risk coordinator failed',
        expect.objectContaining({ error: 'env var missing' })
      );

      process.exitCode = originalExitCode;
    });
  });

  describe('logging', () => {
    it('logs startup with policy info', async () => {
      mockLoadContext.mockReturnValue(defaultContext());
      mockGetRun.mockResolvedValue({ status: 'completed' });
      mockGetEvents.mockResolvedValue([]);

      await runWorker();
      await jest.advanceTimersByTimeAsync(1000);

      expect(mockLogAgent).toHaveBeenCalledWith(
        'risk coordinator started',
        expect.objectContaining({
          participantId: 'risk-coordinator',
          policyType: 'majority',
          policyVersion: 'policy.fraud.majority-veto'
        })
      );
    });
  });
});
