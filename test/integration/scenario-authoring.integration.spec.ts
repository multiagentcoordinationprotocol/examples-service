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

    it('keeps inlined commitments inside executionRequest (scenario-layer only); control-plane RunDescriptor stays scenario-agnostic', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      // Commitments resolved from !include DO appear on executionRequest
      // (the scenario-layer artifact consumed by agents via bootstrap).
      const compiledCommitments = result.compiled.executionRequest.session.commitments;
      expect(compiledCommitments).toHaveLength(2);
      expect(compiledCommitments[0].id).toBe('fraud-risk-assessed');

      if (!ctx.mockControlPlane) return; // remote/docker mode skip
      // But they MUST NOT be forwarded to the control-plane (plan CP-1 +
      // RFC-MACP-0001 §3): the CP's RunDescriptor contract strips scenario
      // semantics entirely.
      const validateBody = ctx.mockControlPlane.validateRequests[0].body as any;
      const createBody = ctx.mockControlPlane.createRunRequests[0].body as any;
      expect(validateBody.session.commitments).toBeUndefined();
      expect(createBody.session.commitments).toBeUndefined();
    });

    it('produces identical compiled output for repeated calls (loader is deterministic with includes)', async () => {
      const a = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      const b = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      expect(a.executionRequest.session.commitments).toEqual(b.executionRequest.session.commitments);
      expect(a.executionRequest.session.participants).toEqual(b.executionRequest.session.participants);
    });
  });
});
