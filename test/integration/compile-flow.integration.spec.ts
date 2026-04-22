import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import {
  fraudScenarioCompileRequest,
  lendingScenarioCompileRequest,
  claimsScenarioCompileRequest
} from '../fixtures/integration-requests';

describe('Compile Flow (integration)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  describe('POST /launch/compile - fraud scenario', () => {
    it('compiles valid inputs into a RunDescriptor + initiator', async () => {
      const result = await ctx.client.compile(fraudScenarioCompileRequest());
      const body = result as any;

      expect(body.runDescriptor).toBeDefined();
      expect(body.mode).toBe('sandbox');
      expect(body.runDescriptor.runtime).toEqual({ kind: 'rust', version: 'v1' });
      expect(body.runDescriptor.session.modeName).toBe('macp.mode.decision.v1');
      expect(body.runDescriptor.session.participants).toHaveLength(4);
      expect(body.scenarioMeta.sessionContext.transactionAmount).toBe(3200);
      expect(body.scenarioMeta.sessionContext.isVipCustomer).toBe(true);
      expect(body.runDescriptor.session.metadata.source).toBe('example-service');
      expect(body.initiator.kickoff.messageType).toBe('Proposal');
    });

    it('returns participant bindings', async () => {
      const result = await ctx.client.compile(fraudScenarioCompileRequest());
      expect((result as any).participantBindings).toHaveLength(4);

      const bindings = (result as any).participantBindings;
      for (const binding of bindings) {
        expect(binding).toHaveProperty('participantId');
        expect(binding).toHaveProperty('role');
        expect(binding).toHaveProperty('agentRef');
      }
    });

    it('returns display information', async () => {
      const result = await ctx.client.compile(fraudScenarioCompileRequest());
      expect((result as any).display).toBeDefined();
      expect((result as any).display.title).toBe('High Value Purchase From New Device');
      expect((result as any).display.scenarioRef).toBe('fraud/high-value-new-device@1.0.0');
    });

    it('applies strict-risk template overrides', async () => {
      const result = await ctx.client.compile(fraudScenarioCompileRequest({ templateId: 'strict-risk' }));
      expect((result as any).runDescriptor.session.ttlMs).toBe(180000);
    });
  });

  describe('POST /launch/compile - validation errors', () => {
    it('returns 400 for invalid inputs (negative amount)', async () => {
      const { status, body } = await ctx.client.requestRaw('POST', '/launch/compile', {
        body: fraudScenarioCompileRequest({
          inputs: {
            transactionAmount: -5,
            deviceTrustScore: 0.5,
            accountAgeDays: 10,
            isVipCustomer: true,
            priorChargebacks: 0
          }
        })
      });
      expect(status).toBe(400);
      expect(body).toHaveProperty('errorCode', 'VALIDATION_ERROR');
    });

    it('returns 400 for invalid scenarioRef', async () => {
      const { status, body } = await ctx.client.requestRaw('POST', '/launch/compile', {
        body: { scenarioRef: 'bad-ref', inputs: {} }
      });
      expect(status).toBe(400);
      expect(body).toHaveProperty('errorCode', 'INVALID_SCENARIO_REF');
    });

    it('returns 404 for nonexistent scenario', async () => {
      const { status, body } = await ctx.client.requestRaw('POST', '/launch/compile', {
        body: { scenarioRef: 'fraud/nonexistent@1.0.0', inputs: {} }
      });
      expect(status).toBe(404);
      expect(body).toHaveProperty('errorCode', 'SCENARIO_NOT_FOUND');
    });
  });

  describe('POST /launch/compile - cross-pack', () => {
    it('compiles lending scenario', async () => {
      const result = await ctx.client.compile(lendingScenarioCompileRequest());
      const body = result as any;
      expect(body.mode).toBe('sandbox');
      expect(body.runDescriptor.session.participants).toHaveLength(4);
      expect(body.scenarioMeta.sessionContext.loanAmount).toBe(25000);
      expect(body.scenarioMeta.sessionContext.creditScore).toBe(680);
    });

    it('compiles claims scenario', async () => {
      const result = await ctx.client.compile(claimsScenarioCompileRequest());
      const body = result as any;
      expect(body.mode).toBe('sandbox');
      expect(body.runDescriptor.session.participants).toHaveLength(4);
      expect(body.scenarioMeta.sessionContext.claimAmount).toBe(8500);
      expect(body.scenarioMeta.sessionContext.incidentSeverity).toBe('moderate');
    });
  });
});
