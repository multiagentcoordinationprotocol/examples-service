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

    it('sends a scenario-agnostic RunDescriptor to /runs/validate', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const validateBody = ctx.mockControlPlane!.validateRequests[0].body as any;
      expect(validateBody.mode).toBe('sandbox');
      expect(validateBody.runtime).toEqual({ kind: 'rust', version: 'v1' });
      expect(validateBody.session).toBeDefined();
      expect(validateBody.session.modeName).toBe('macp.mode.decision.v1');
      expect(validateBody.session.participants).toHaveLength(4);
      // Per plan CP-1, scenario-specific fields must NOT appear on the
      // control-plane's /runs contract (forbidNonWhitelisted rejects them).
      expect(validateBody.session.context).toBeUndefined();
      expect(validateBody.session.commitments).toBeUndefined();
      expect(validateBody.session.policyHints).toBeUndefined();
      expect(validateBody.session.initiatorParticipantId).toBeUndefined();
      expect(validateBody.kickoff).toBeUndefined();
    });

    it('sends matching payload to /runs and /runs/validate', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const validateBody = ctx.mockControlPlane!.validateRequests[0].body as any;
      const createBody = ctx.mockControlPlane!.createRunRequests[0].body as any;

      expect(createBody.mode).toBe(validateBody.mode);
      expect(createBody.session.modeName).toBe(validateBody.session.modeName);
      expect(createBody.session.participants.length).toBe(validateBody.session.participants.length);
      expect(createBody.session.sessionId).toBe(validateBody.session.sessionId);
    });

    it('sends correct content-type header', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const headers = ctx.mockControlPlane!.validateRequests[0].headers;
      expect(headers['content-type']).toBe('application/json');
    });

    it('posts participants as bare {id} objects (no role, no transportIdentity)', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const createBody = ctx.mockControlPlane!.createRunRequests[0].body as any;
      for (const participant of createBody.session.participants) {
        expect(Object.keys(participant).sort()).toEqual(['id']);
        expect(typeof participant.id).toBe('string');
      }
    });

    it('does not forward session.commitments to the control plane', async () => {
      await ctx.client.runExample(fraudScenarioRunRequest());

      const validateBody = ctx.mockControlPlane!.validateRequests[0].body as any;
      const createBody = ctx.mockControlPlane!.createRunRequests[0].body as any;

      // Scenario-specific fields live on the initiator's bootstrap, not the
      // control-plane request (plan §Invariants 3 + CP-1).
      expect(validateBody.session.commitments).toBeUndefined();
      expect(createBody.session.commitments).toBeUndefined();
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

  describe('Direct-agent-auth (ES-9)', () => {
    it('pre-allocates a UUID v4 sessionId and threads it through executionRequest.session.metadata', async () => {
      const result = (await ctx.client.runExample(fraudScenarioRunRequest())) as any;

      const sessionId = result.compiled.sessionId;
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(result.compiled.executionRequest.session.metadata.sessionId).toBe(sessionId);
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
      expect(result.compiled.initiator.participantId).toBe(
        result.compiled.executionRequest.session.initiatorParticipantId
      );
      expect(result.compiled.initiator.sessionStart.participants).toEqual(
        result.compiled.executionRequest.session.participants.map((p: any) => p.id)
      );
      expect(result.compiled.initiator.kickoff).toBeDefined();
    });
  });

  describe('Direct-agent-auth with configured tokens', () => {
    let authCtx: IntegrationTestContext;

    beforeAll(async () => {
      authCtx = await createIntegrationTestApp({
        agentRuntimeTokens: {
          'fraud-agent': 'tok-fraud',
          'growth-agent': 'tok-growth',
          'compliance-agent': 'tok-comp',
          'risk-agent': 'tok-risk'
        },
        runtimeAddress: 'runtime.local:50051',
        runtimeTls: true,
        runtimeAllowInsecure: false
      });
    });

    afterAll(async () => {
      if (authCtx) await authCtx.cleanup();
    });

    it('control-plane still receives exactly one validate + one createRun (no Send-forging) regardless of direct-auth', async () => {
      if (!authCtx.mockControlPlane) {
        return;
      }
      authCtx.mockControlPlane.clearRequests();
      await authCtx.client.runExample(fraudScenarioRunRequest());

      expect(authCtx.mockControlPlane.validateRequests).toHaveLength(1);
      expect(authCtx.mockControlPlane.createRunRequests).toHaveLength(1);
      // Observer-only invariant (RFC-MACP-0001 §5.3 + plan §5): neither the
      // examples-service nor any spawned agent may POST to
      // /runs/:id/{messages,signal,context}. Agents write envelopes via gRPC
      // directly to the runtime, which is not observable on this HTTP mock.
      expect(authCtx.mockControlPlane.messageRequests).toHaveLength(0);
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
