import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import {
  fraudScenarioRunRequest,
  lendingScenarioRunRequest,
  claimsScenarioRunRequest
} from '../fixtures/integration-requests';

describe('Example Run - Submit to Control Plane (integration)', () => {
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

  describe('POST /examples/run with submitToControlPlane=true', () => {
    it('completes full flow: compile → validate → create run', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      expect(result.compiled).toBeDefined();
      expect(result.compiled.executionRequest).toBeDefined();
      expect(result.compiled.executionRequest.mode).toBe('sandbox');
      expect(result.compiled.executionRequest.session.modeName).toBe('macp.mode.decision.v1');

      expect(result.controlPlane).toBeDefined();
      expect(result.controlPlane.validated).toBe(true);
      expect(result.controlPlane.submitted).toBe(true);
      expect(result.controlPlane.runId).toBeDefined();
      expect(result.controlPlane.status).toBe('queued');
      expect(result.controlPlane.traceId).toBeDefined();
    });

    it('returns runId as a UUID', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;
      expect(result.controlPlane.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
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

    it('returns control plane base URL', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;
      expect(result.controlPlane.baseUrl).toBeDefined();
      expect(result.controlPlane.baseUrl).toContain('http');
    });
  });

  const describeIfMock =
    (process.env.INTEGRATION_CONTROL_PLANE ?? 'mock') === 'mock' ? describe : describe.skip;

  describeIfMock('Mock control plane request verification', () => {
    it('sends exactly one validate and one createRun request', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      expect(ctx.mockControlPlane!.validateRequests).toHaveLength(1);
      expect(ctx.mockControlPlane!.createRunRequests).toHaveLength(1);
    });

    it('sends valid ExecutionRequest to /runs/validate', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const validateBody = ctx.mockControlPlane!.validateRequests[0].body as any;
      expect(validateBody.mode).toBe('sandbox');
      expect(validateBody.session).toBeDefined();
      expect(validateBody.session.modeName).toBe('macp.mode.decision.v1');
      expect(validateBody.session.participants).toHaveLength(4);
      expect(validateBody.session.context).toBeDefined();
      expect(validateBody.session.context.transactionAmount).toBe(3200);
      expect(validateBody.kickoff).toHaveLength(1);
      expect(validateBody.kickoff[0].messageType).toBe('Proposal');
      expect(validateBody.runtime).toEqual({ kind: 'rust', version: 'v1' });
    });

    it('sends matching payload to /runs and /runs/validate', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const validateBody = ctx.mockControlPlane!.validateRequests[0].body as any;
      const createBody = ctx.mockControlPlane!.createRunRequests[0].body as any;

      expect(createBody.mode).toBe(validateBody.mode);
      expect(createBody.session.modeName).toBe(validateBody.session.modeName);
      expect(createBody.session.participants.length).toBe(validateBody.session.participants.length);
    });

    it('sends correct content-type header', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const headers = ctx.mockControlPlane!.validateRequests[0].headers;
      expect(headers['content-type']).toBe('application/json');
    });

    it('participants have transport identity from hosted agents', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const createBody = ctx.mockControlPlane!.createRunRequests[0].body as any;
      for (const participant of createBody.session.participants) {
        expect(participant.transportIdentity).toContain('agent://');
      }
    });
  });

  describe('Cross-pack submission', () => {
    beforeEach(() => {
      if (ctx.mockControlPlane) {
        ctx.mockControlPlane.clearRequests();
      }
    });

    it('submits lending scenario to control plane', async () => {
      const result = (await ctx.client.runExample(lendingScenarioRunRequest())) as any;

      expect(result.controlPlane.validated).toBe(true);
      expect(result.controlPlane.submitted).toBe(true);
      expect(result.controlPlane.runId).toBeDefined();
      expect(result.compiled.executionRequest.session.context.loanAmount).toBe(25000);
    });

    it('submits claims scenario to control plane', async () => {
      const result = (await ctx.client.runExample(claimsScenarioRunRequest())) as any;

      expect(result.controlPlane.validated).toBe(true);
      expect(result.controlPlane.submitted).toBe(true);
      expect(result.controlPlane.runId).toBeDefined();
      expect(result.compiled.executionRequest.session.context.claimAmount).toBe(8500);
    });
  });

  describeIfMock('Bearer token authentication', () => {
    let authCtx: IntegrationTestContext;

    beforeAll(async () => {
      authCtx = await createIntegrationTestApp({
        controlPlaneApiKey: 'test-cp-api-key',
        mockControlPlaneOptions: { requiredBearerToken: 'test-cp-api-key' }
      });
    });

    afterAll(async () => {
      if (authCtx) await authCtx.cleanup();
    });

    it('sends Authorization header when controlPlaneApiKey is set', async () => {
      const result = (await authCtx.client.runExample(fraudScenarioRunRequest())) as any;

      expect(result.controlPlane.submitted).toBe(true);

      const headers = authCtx.mockControlPlane!.validateRequests[0].headers;
      expect(headers['authorization']).toBe('Bearer test-cp-api-key');
    });
  });
});
