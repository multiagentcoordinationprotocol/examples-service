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

    it('forwards inlined commitments through /examples/run to the control plane', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      if (!ctx.mockControlPlane) return; // remote/docker mode skip
      const validateBody = ctx.mockControlPlane.validateRequests[0].body as any;
      const createBody = ctx.mockControlPlane.createRunRequests[0].body as any;

      // Both validate and create payloads must carry the !include-resolved commitments
      expect(validateBody.session.commitments).toBeDefined();
      expect(validateBody.session.commitments).toHaveLength(2);
      expect(createBody.session.commitments).toEqual(validateBody.session.commitments);
      expect(validateBody.session.commitments[0].id).toBe('fraud-risk-assessed');
    });

    it('produces identical compiled output for repeated calls (loader is deterministic with includes)', async () => {
      const a = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      const b = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      expect(a.executionRequest.session.commitments).toEqual(b.executionRequest.session.commitments);
      expect(a.executionRequest.session.participants).toEqual(b.executionRequest.session.participants);
    });
  });
});
