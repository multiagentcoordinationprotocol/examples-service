import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import { fraudScenarioCompileRequest, fraudScenarioRunRequest } from '../fixtures/integration-requests';

describe('Scenario authoring (integration)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  beforeEach(() => {
    if (ctx.mockControlPlane) {
      ctx.mockControlPlane.clearRequests();
    }
  });

  describe('!include propagation through HTTP path', () => {
    it('inlines _shared/commitments/fraud.yaml on /launch/compile', async () => {
      const result = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      expect(result.executionRequest.session.commitments).toEqual([
        {
          id: 'fraud-risk-assessed',
          title: 'Fraud risk assessed',
          description:
            'Fraud specialist has evaluated transaction signals and recorded a risk verdict.',
          requiredRoles: ['fraud'],
          policyRef: 'policy.default'
        },
        {
          id: 'decision-finalized',
          title: 'Decision finalized',
          description: 'Risk coordinator has reconciled inputs and committed a final decision.',
          requiredRoles: ['risk']
        }
      ]);
    });

    it('keeps inlined commitments inside executionRequest and strips them from runDescriptor', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      // Commitments resolved from !include DO appear on executionRequest
      // (the scenario-layer artifact consumed by agents via bootstrap).
      const compiledCommitments = result.compiled.executionRequest.session.commitments;
      expect(compiledCommitments).toHaveLength(2);
      expect(compiledCommitments[0].id).toBe('fraud-risk-assessed');

      // But they MUST NOT appear on the scenario-agnostic runDescriptor.
      const descriptor = result.compiled.runDescriptor;
      const descriptorSession = descriptor.session as Record<string, unknown>;
      expect(descriptorSession.commitments).toBeUndefined();
    });

    it('produces identical compiled output for repeated calls (loader is deterministic with includes)', async () => {
      const a = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      const b = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      expect(a.executionRequest.session.commitments).toEqual(b.executionRequest.session.commitments);
      expect(a.executionRequest.session.participants).toEqual(b.executionRequest.session.participants);
    });
  });
});
