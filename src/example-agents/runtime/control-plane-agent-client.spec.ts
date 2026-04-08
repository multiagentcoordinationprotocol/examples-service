import {
  buildProtoEnvelope,
  extractDecodedPayload,
  extractMessageType,
  extractProposalId,
  extractSender,
  loadAgentRuntimeContext,
  parseJsonRecord,
  parseStringArray,
  CanonicalEvent
} from './control-plane-agent-client';

describe('control-plane-agent-client', () => {
  describe('parseJsonRecord', () => {
    it('parses valid JSON objects', () => {
      expect(parseJsonRecord('{"key":"value"}')).toEqual({ key: 'value' });
    });

    it('returns empty object for undefined', () => {
      expect(parseJsonRecord(undefined)).toEqual({});
    });

    it('returns empty object for empty string', () => {
      expect(parseJsonRecord('')).toEqual({});
    });

    it('returns empty object for invalid JSON', () => {
      expect(parseJsonRecord('not-json')).toEqual({});
    });

    it('returns empty object for JSON arrays', () => {
      expect(parseJsonRecord('[1,2,3]')).toEqual({});
    });
  });

  describe('parseStringArray', () => {
    it('parses valid JSON string arrays', () => {
      expect(parseStringArray('["a","b","c"]')).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for undefined', () => {
      expect(parseStringArray(undefined)).toEqual([]);
    });

    it('returns empty array for invalid JSON', () => {
      expect(parseStringArray('not-json')).toEqual([]);
    });

    it('filters out non-string values', () => {
      expect(parseStringArray('["a",1,true,"b"]')).toEqual(['a', 'b']);
    });
  });

  describe('loadAgentRuntimeContext', () => {
    const requiredEnv = {
      EXAMPLE_AGENT_RUN_ID: 'run-1',
      EXAMPLE_AGENT_SCENARIO_REF: 'fraud/test@1.0.0',
      EXAMPLE_AGENT_MODE_NAME: 'macp.mode.decision.v1',
      EXAMPLE_AGENT_PARTICIPANT_ID: 'fraud-agent',
      EXAMPLE_AGENT_ROLE: 'fraud',
      EXAMPLE_AGENT_FRAMEWORK: 'langgraph',
      EXAMPLE_AGENT_REF: 'fraud-agent'
    };

    let savedEnv: Record<string, string | undefined>;

    beforeEach(() => {
      savedEnv = {};
      for (const key of Object.keys(requiredEnv)) {
        savedEnv[key] = process.env[key];
      }
      Object.assign(process.env, requiredEnv);
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    it('reads required env vars into context', () => {
      const context = loadAgentRuntimeContext();
      expect(context.runId).toBe('run-1');
      expect(context.scenarioRef).toBe('fraud/test@1.0.0');
      expect(context.participantId).toBe('fraud-agent');
      expect(context.framework).toBe('langgraph');
    });

    it('throws on missing required env var', () => {
      delete process.env.EXAMPLE_AGENT_RUN_ID;
      expect(() => loadAgentRuntimeContext()).toThrow(/missing required environment variable/);
    });

    it('uses defaults for optional env vars', () => {
      const context = loadAgentRuntimeContext();
      expect(context.modeVersion).toBe('1.0.0');
      expect(context.configurationVersion).toBe('config.default');
      expect(context.ttlMs).toBe(300000);
    });

    it('parses policyHints from EXAMPLE_AGENT_POLICY_HINTS_JSON', () => {
      process.env.EXAMPLE_AGENT_POLICY_HINTS_JSON = JSON.stringify({
        type: 'majority',
        threshold: 0.5,
        vetoEnabled: true
      });
      const context = loadAgentRuntimeContext();
      expect(context.policyHints).toEqual({
        type: 'majority',
        threshold: 0.5,
        vetoEnabled: true
      });
      delete process.env.EXAMPLE_AGENT_POLICY_HINTS_JSON;
    });

    it('parses RFC-MACP-0012 fields from EXAMPLE_AGENT_POLICY_HINTS_JSON', () => {
      process.env.EXAMPLE_AGENT_POLICY_HINTS_JSON = JSON.stringify({
        type: 'supermajority',
        threshold: 0.67,
        vetoEnabled: true,
        vetoThreshold: 2,
        minimumConfidence: 0.6,
        designatedRoles: ['risk', 'compliance']
      });
      const context = loadAgentRuntimeContext();
      expect(context.policyHints).toEqual({
        type: 'supermajority',
        threshold: 0.67,
        vetoEnabled: true,
        vetoThreshold: 2,
        minimumConfidence: 0.6,
        designatedRoles: ['risk', 'compliance']
      });
      delete process.env.EXAMPLE_AGENT_POLICY_HINTS_JSON;
    });

    it('returns undefined-like policyHints when env var not set', () => {
      delete process.env.EXAMPLE_AGENT_POLICY_HINTS_JSON;
      const context = loadAgentRuntimeContext();
      expect(context.policyHints).toEqual({});
    });
  });

  describe('buildProtoEnvelope', () => {
    it('produces correct envelope structure', () => {
      const envelope = buildProtoEnvelope('macp.v1.TestPayload', { key: 'value' });
      expect(envelope).toEqual({
        encoding: 'proto',
        proto: {
          typeName: 'macp.v1.TestPayload',
          value: { key: 'value' }
        }
      });
    });
  });

  describe('extractProposalId', () => {
    it('extracts from decodedPayload.proposalId', () => {
      const event: CanonicalEvent = {
        seq: 1,
        type: 'proposal.created',
        data: { decodedPayload: { proposalId: 'p-1' } }
      };
      expect(extractProposalId(event)).toBe('p-1');
    });

    it('extracts from payload.proposal_id (snake_case)', () => {
      const event: CanonicalEvent = {
        seq: 1,
        type: 'proposal.created',
        data: { payload: { proposal_id: 'p-2' } }
      };
      expect(extractProposalId(event)).toBe('p-2');
    });

    it('falls back to subject.id', () => {
      const event: CanonicalEvent = {
        seq: 1,
        type: 'proposal.created',
        subject: { kind: 'proposal', id: 'p-3' }
      };
      expect(extractProposalId(event)).toBe('p-3');
    });

    it('returns undefined when no proposal id found', () => {
      const event: CanonicalEvent = { seq: 1, type: 'other' };
      expect(extractProposalId(event)).toBeUndefined();
    });
  });

  describe('extractMessageType', () => {
    it('extracts messageType from event data', () => {
      const event: CanonicalEvent = { seq: 1, type: 'proposal.updated', data: { messageType: 'Evaluation' } };
      expect(extractMessageType(event)).toBe('Evaluation');
    });

    it('returns undefined when missing', () => {
      const event: CanonicalEvent = { seq: 1, type: 'other', data: {} };
      expect(extractMessageType(event)).toBeUndefined();
    });
  });

  describe('extractSender', () => {
    it('extracts sender from event data', () => {
      const event: CanonicalEvent = { seq: 1, type: 'proposal.updated', data: { sender: 'fraud-agent' } };
      expect(extractSender(event)).toBe('fraud-agent');
    });
  });

  describe('extractDecodedPayload', () => {
    it('returns decodedPayload when present', () => {
      const event: CanonicalEvent = {
        seq: 1,
        type: 'proposal.updated',
        data: { decodedPayload: { recommendation: 'APPROVE' } }
      };
      expect(extractDecodedPayload(event)).toEqual({ recommendation: 'APPROVE' });
    });

    it('falls back to payload', () => {
      const event: CanonicalEvent = {
        seq: 1,
        type: 'proposal.updated',
        data: { payload: { recommendation: 'REVIEW' } }
      };
      expect(extractDecodedPayload(event)).toEqual({ recommendation: 'REVIEW' });
    });

    it('returns empty object when no payload', () => {
      const event: CanonicalEvent = { seq: 1, type: 'other' };
      expect(extractDecodedPayload(event)).toEqual({});
    });
  });
});
