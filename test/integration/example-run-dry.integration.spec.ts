import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import {
  fraudScenarioRunRequest,
  lendingScenarioRunRequest,
  claimsScenarioRunRequest
} from '../fixtures/integration-requests';

describe('Example Run - Dry Run (integration)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  describe('POST /examples/run with submitToControlPlane=false', () => {
    it('compiles and resolves agents without calling control plane', async () => {
      const result = (await ctx.client.runExample(
        fraudScenarioRunRequest({ submitToControlPlane: false })
      )) as any;

      expect(result.compiled).toBeDefined();
      expect(result.compiled.executionRequest).toBeDefined();
      expect(result.controlPlane.submitted).toBe(false);
      expect(result.controlPlane.validated).toBe(false);
    });

    it('resolves 4 hosted agents with correct frameworks', async () => {
      const result = (await ctx.client.runExample(
        fraudScenarioRunRequest({ submitToControlPlane: false })
      )) as any;

      expect(result.hostedAgents).toHaveLength(4);

      const frameworks = result.hostedAgents.map((a: any) => a.framework).sort();
      expect(frameworks).toEqual(['crewai', 'custom', 'langchain', 'langgraph']);
    });

    it('each hosted agent has transport identity and metadata', async () => {
      const result = (await ctx.client.runExample(
        fraudScenarioRunRequest({ submitToControlPlane: false })
      )) as any;

      for (const agent of result.hostedAgents) {
        expect(agent.transportIdentity).toContain('agent://');
        expect(agent.participantId).toBeDefined();
        expect(agent.agentRef).toBeDefined();
        expect(agent.framework).toBeDefined();
        expect(agent.entrypoint).toBeDefined();
        expect(agent.bootstrapStrategy).toBeDefined();
        expect(agent.bootstrapMode).toBeDefined();
        expect(agent.status).toBeDefined();
      }
    });

    it('with bootstrapAgents=false returns empty hostedAgents', async () => {
      const result = (await ctx.client.runExample(
        fraudScenarioRunRequest({ submitToControlPlane: false, bootstrapAgents: false })
      )) as any;

      expect(result.hostedAgents).toHaveLength(0);
      expect(result.compiled.executionRequest).toBeDefined();
    });

    if ((process.env.INTEGRATION_CONTROL_PLANE ?? 'mock') === 'mock') {
      it('mock control plane received zero requests', async () => {
        ctx.mockControlPlane!.clearRequests();

        await ctx.client.runExample(fraudScenarioRunRequest({ submitToControlPlane: false }));

        expect(ctx.mockControlPlane!.requests).toHaveLength(0);
      });
    }
  });

  describe('Cross-pack dry runs', () => {
    it('dry run with lending scenario resolves 4 agents', async () => {
      const result = (await ctx.client.runExample(
        lendingScenarioRunRequest({ submitToControlPlane: false })
      )) as any;

      expect(result.hostedAgents).toHaveLength(4);
      expect(result.compiled.executionRequest.session.context.loanAmount).toBe(25000);
      expect(result.controlPlane.submitted).toBe(false);
    });

    it('dry run with claims scenario resolves 4 agents', async () => {
      const result = (await ctx.client.runExample(
        claimsScenarioRunRequest({ submitToControlPlane: false })
      )) as any;

      expect(result.hostedAgents).toHaveLength(4);
      expect(result.compiled.executionRequest.session.context.claimAmount).toBe(8500);
      expect(result.controlPlane.submitted).toBe(false);
    });
  });
});
