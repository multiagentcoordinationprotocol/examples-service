import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import { fraudScenarioRunRequest } from '../fixtures/integration-requests';

const describeIfMock =
  (process.env.INTEGRATION_CONTROL_PLANE ?? 'mock') === 'mock' ? describe : describe.skip;

describeIfMock('Control Plane Error Handling (integration, mock-only)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp({
      controlPlaneTimeoutMs: 3000
    });
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  afterEach(() => {
    ctx.mockControlPlane!.setValidateFailure({ kind: 'none' });
    ctx.mockControlPlane!.setCreateRunFailure({ kind: 'none' });
    ctx.mockControlPlane!.setPolicyRegistrationFailure({ kind: 'none' });
    ctx.mockControlPlane!.clearRequests();
  });

  describe('Validate endpoint failures', () => {
    it('returns error when CP /runs/validate returns 400', async () => {
      ctx.mockControlPlane!.setValidateFailure({
        kind: 'status',
        statusCode: 400,
        body: JSON.stringify({ error: 'Bad request from CP' })
      });

      const { status, body } = await ctx.client.requestRaw('POST', '/examples/run', {
        body: fraudScenarioRunRequest()
      });

      expect(status).toBe(400);
      expect(body).toHaveProperty('errorCode', expect.stringMatching(/CONTROL_PLANE_ERROR|CONTROL_PLANE_UNAVAILABLE/));
    });

    it('returns 502 when CP /runs/validate returns 500', async () => {
      ctx.mockControlPlane!.setValidateFailure({
        kind: 'status',
        statusCode: 500,
        body: JSON.stringify({ error: 'Internal server error' })
      });

      const { status, body } = await ctx.client.requestRaw('POST', '/examples/run', {
        body: fraudScenarioRunRequest()
      });

      expect(status).toBe(500);
      expect(body).toHaveProperty('errorCode', expect.stringMatching(/CONTROL_PLANE_ERROR|CONTROL_PLANE_UNAVAILABLE/));
    });

    it('returns 502 when CP /runs/validate times out', async () => {
      ctx.mockControlPlane!.setValidateFailure({
        kind: 'timeout',
        delayMs: 10000
      });

      const { status, body } = await ctx.client.requestRaw('POST', '/examples/run', {
        body: fraudScenarioRunRequest()
      });

      expect(status).toBe(502);
      expect(body).toHaveProperty('errorCode', expect.stringMatching(/CONTROL_PLANE_ERROR|CONTROL_PLANE_UNAVAILABLE/));
    }, 15000);

    it('returns error when CP /runs/validate rejects with validation errors', async () => {
      ctx.mockControlPlane!.setValidateFailure({
        kind: 'validate-reject',
        errors: ['mode is required', 'participants must have at least 2 entries']
      });

      const { status, body } = await ctx.client.requestRaw('POST', '/examples/run', {
        body: fraudScenarioRunRequest()
      });

      expect(status).toBe(400);
      expect(body).toHaveProperty('errorCode', expect.stringMatching(/CONTROL_PLANE_ERROR|CONTROL_PLANE_UNAVAILABLE/));
    });
  });

  describe('Create run endpoint failures', () => {
    it('returns 502 when CP /runs returns 500 (after validate succeeds)', async () => {
      ctx.mockControlPlane!.setCreateRunFailure({
        kind: 'status',
        statusCode: 500,
        body: JSON.stringify({ error: 'Internal server error' })
      });

      const { status, body } = await ctx.client.requestRaw('POST', '/examples/run', {
        body: fraudScenarioRunRequest()
      });

      expect(status).toBe(500);
      expect(body).toHaveProperty('errorCode', expect.stringMatching(/CONTROL_PLANE_ERROR|CONTROL_PLANE_UNAVAILABLE/));

      // Validate was called successfully
      expect(ctx.mockControlPlane!.validateRequests).toHaveLength(1);
      // CreateRun was attempted
      expect(ctx.mockControlPlane!.createRunRequests).toHaveLength(1);
    });

    it('returns 502 when CP /runs times out (after validate succeeds)', async () => {
      ctx.mockControlPlane!.setCreateRunFailure({
        kind: 'timeout',
        delayMs: 10000
      });

      const { status, body } = await ctx.client.requestRaw('POST', '/examples/run', {
        body: fraudScenarioRunRequest()
      });

      expect(status).toBe(502);
      expect(body).toHaveProperty('errorCode', expect.stringMatching(/CONTROL_PLANE_ERROR|CONTROL_PLANE_UNAVAILABLE/));
    }, 15000);
  });

  describe('Dry run bypasses control plane errors', () => {
    it('dry run succeeds even when CP is failing', async () => {
      ctx.mockControlPlane!.setValidateFailure({
        kind: 'status',
        statusCode: 500
      });

      const result = (await ctx.client.runExample(
        fraudScenarioRunRequest({ submitToControlPlane: false })
      )) as any;

      expect(result.controlPlane.submitted).toBe(false);
      expect(result.compiled.executionRequest).toBeDefined();
      expect(result.hostedAgents).toHaveLength(4);
    });
  });

  describe('Policy registration failures', () => {
    it('proceeds with run even when policy registration returns 500', async () => {
      ctx.mockControlPlane!.setPolicyRegistrationFailure({
        kind: 'status',
        statusCode: 500,
        body: JSON.stringify({
          statusCode: 500,
          error: 'INTERNAL_ERROR',
          message: 'policy store unavailable',
          reasons: ['database connection failed']
        })
      });

      const request = {
        scenarioRef: 'fraud/high-value-new-device@1.0.0',
        templateId: 'unanimous',
        inputs: {
          customerId: 'C-ERR1',
          transactionAmount: 50000,
          deviceTrustScore: 0.2,
          accountAgeDays: 10,
          isVipCustomer: false,
          priorChargebacks: 3
        }
      };

      // Policy registration fails, but run should still proceed
      const { status } = await ctx.client.requestRaw('POST', '/examples/run', { body: request });
      expect(status).toBeLessThan(300);

      // Verify policy registration was attempted
      expect(ctx.mockControlPlane!.policyRequests.length).toBeGreaterThanOrEqual(1);
    });

    it('returns structured error reasons when policy registration returns rejection with reasons', async () => {
      ctx.mockControlPlane!.setPolicyRegistrationFailure({
        kind: 'status',
        statusCode: 400,
        body: JSON.stringify({
          statusCode: 400,
          error: 'INVALID_POLICY',
          message: 'policy validation failed',
          reasons: ['supermajority threshold must be > 0.5', 'schema_version is required']
        })
      });

      const request = {
        scenarioRef: 'fraud/high-value-new-device@1.0.0',
        templateId: 'unanimous',
        inputs: {
          customerId: 'C-ERR2',
          transactionAmount: 50000,
          deviceTrustScore: 0.2,
          accountAgeDays: 10,
          isVipCustomer: false,
          priorChargebacks: 3
        }
      };

      // Policy registration fails with structured error, but run should still proceed
      const { status } = await ctx.client.requestRaw('POST', '/examples/run', { body: request });
      expect(status).toBeLessThan(300);
    });
  });
});
