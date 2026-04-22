import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import {
  fraudScenarioRunRequest,
  lendingScenarioRunRequest,
  claimsScenarioRunRequest
} from '../fixtures/integration-requests';

describe('Example Run (integration)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  describe('POST /examples/run', () => {
    it('completes full flow: compile + bootstrap agents', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      expect(result.compiled).toBeDefined();
      expect(result.compiled.runDescriptor).toBeDefined();
      expect(result.compiled.mode).toBe('sandbox');
      expect(result.compiled.runDescriptor.session.modeName).toBe('macp.mode.decision.v1');
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('returns hosted agents with bootstrap metadata', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      expect(result.hostedAgents).toHaveLength(4);
      for (const agent of result.hostedAgents) {
        expect(agent.transportIdentity).toContain('agent://');
        expect(agent.participantId).toBeDefined();
        expect(agent.framework).toBeDefined();
        expect(agent.entrypoint).toBeDefined();
        expect(agent.bootstrapStrategy).toBeDefined();
      }

      const frameworks = result.hostedAgents.map((a: any) => a.framework).sort();
      expect(frameworks).toEqual(['crewai', 'custom', 'langchain', 'langgraph']);
    });
  });

  describe('Cross-pack runs', () => {
    it('runs lending scenario', async () => {
      const result = (await ctx.client.runExample(lendingScenarioRunRequest())) as any;

      expect(result.sessionId).toBeDefined();
      expect(result.compiled.scenarioMeta.sessionContext.loanAmount).toBe(25000);
    });

    it('runs claims scenario', async () => {
      const result = (await ctx.client.runExample(claimsScenarioRunRequest())) as any;

      expect(result.sessionId).toBeDefined();
      expect(result.compiled.scenarioMeta.sessionContext.claimAmount).toBe(8500);
    });
  });

  describe('Direct-agent-auth (ES-9)', () => {
    it('pre-allocates a UUID v4 sessionId and threads it through runDescriptor', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      const sessionId = result.compiled.sessionId;
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(result.compiled.runDescriptor.session.sessionId).toBe(sessionId);
    });

    it('emits a scenario-agnostic runDescriptor with no policyHints / kickoff / commitments', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      const descriptor = result.compiled.runDescriptor;
      expect(descriptor.session.modeName).toBe('macp.mode.decision.v1');
      expect(descriptor.session.participants).toHaveLength(4);
      expect(descriptor.session.policyHints).toBeUndefined();
      expect(descriptor.session.commitments).toBeUndefined();
      expect(descriptor.session.initiatorParticipantId).toBeUndefined();
      expect(descriptor.kickoff).toBeUndefined();
    });

    it('produces an initiator payload targeted at exactly one participant', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      expect(result.compiled.initiator).toBeDefined();
      expect(result.compiled.initiator.participantId).toBe(result.compiled.scenarioMeta.initiatorParticipantId);
      expect(result.compiled.initiator.sessionStart.participants).toEqual(
        result.compiled.runDescriptor.session.participants.map((p: any) => p.id)
      );
      expect(result.compiled.initiator.kickoff).toBeDefined();
    });
  });
});
