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
    it('compiles valid inputs into an ExecutionRequest', async () => {
      const result = await ctx.client.compile(fraudScenarioCompileRequest());

      expect(result.executionRequest).toBeDefined();
      const er = result.executionRequest as any;
      expect(er.mode).toBe('sandbox');
      expect(er.runtime).toEqual({ kind: 'rust', version: 'v1' });
      expect(er.session.modeName).toBe('macp.mode.decision.v1');
      expect(er.session.participants).toHaveLength(4);
      expect(er.session.context.transactionAmount).toBe(3200);
      expect(er.session.context.isVipCustomer).toBe(true);
      expect(er.session.metadata.source).toBe('example-service');
      expect(er.kickoff).toHaveLength(1);
      expect(er.kickoff[0].messageType).toBe('Proposal');
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
      const result = await ctx.client.compile(
        fraudScenarioCompileRequest({ templateId: 'strict-risk' })
      );
      const er = (result as any).executionRequest;
      expect(er.session.ttlMs).toBe(180000);
    });

    it('propagates scenario commitments onto session.commitments', async () => {
      const result = await ctx.client.compile(fraudScenarioCompileRequest());
      const er = (result as any).executionRequest;

      expect(er.session.commitments).toEqual([
        {
          id: 'fraud-risk-assessed',
          title: 'Fraud risk assessed',
          description: 'Fraud specialist has evaluated transaction signals and recorded a risk verdict.',
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
    it('compiles lending scenario with commitments', async () => {
      const result = await ctx.client.compile(lendingScenarioCompileRequest());
      const er = (result as any).executionRequest;
      expect(er.mode).toBe('sandbox');
      expect(er.session.participants).toHaveLength(4);
      expect(er.session.context.loanAmount).toBe(25000);
      expect(er.session.context.creditScore).toBe(680);
      expect(er.session.commitments).toEqual([
        {
          id: 'credit-evaluated',
          title: 'Credit evaluation complete',
          requiredRoles: ['credit-analyst'],
          policyRef: 'policy.lending.conservative'
        },
        {
          id: 'underwriting-decision',
          title: 'Underwriting decision finalized',
          requiredRoles: ['risk']
        }
      ]);
    });

    it('compiles claims scenario and omits commitments when scenario declares none', async () => {
      const result = await ctx.client.compile(claimsScenarioCompileRequest());
      const er = (result as any).executionRequest;
      expect(er.mode).toBe('sandbox');
      expect(er.session.participants).toHaveLength(4);
      expect(er.session.context.claimAmount).toBe(8500);
      expect(er.session.context.incidentSeverity).toBe('moderate');
      expect(er.session.commitments).toBeUndefined();
    });
  });
});
