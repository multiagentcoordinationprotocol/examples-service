import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';

const describeIfMock =
  (process.env.INTEGRATION_CONTROL_PLANE ?? 'mock') === 'mock' ? describe : describe.skip;

describeIfMock('Policy Registration at Launch (integration, mock-only)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  afterEach(() => {
    ctx.mockControlPlane!.clearRequests();
  });

  it('registers policy with control plane before creating run when policyVersion is not default', async () => {
    const request = {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      templateId: 'unanimous',
      inputs: {
        customerId: 'C-999',
        transactionAmount: 50000,
        deviceTrustScore: 0.2,
        accountAgeDays: 10,
        isVipCustomer: false,
        priorChargebacks: 3
      }
    };

    const { status } = await ctx.client.requestRaw('POST', '/examples/run', { body: request });

    // Should have registered the policy before creating run
    const policyRequests = ctx.mockControlPlane!.policyRequests;
    expect(policyRequests.length).toBeGreaterThanOrEqual(1);

    // Verify the policy request body
    const policyBody = policyRequests[0].body as Record<string, unknown>;
    expect(policyBody.policy_id).toBe('policy.fraud.unanimous');

    // Run should still succeed (201/200)
    expect(status).toBeLessThan(300);
  });

  it('does not register policy.default (auto-resolved by runtime)', async () => {
    const request = {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      inputs: {
        customerId: 'C-100',
        transactionAmount: 1000,
        deviceTrustScore: 0.9,
        accountAgeDays: 365,
        isVipCustomer: true,
        priorChargebacks: 0
      }
    };

    const { status } = await ctx.client.requestRaw('POST', '/examples/run', { body: request });

    // Default template uses policy.default — should not register
    const policyRequests = ctx.mockControlPlane!.policyRequests;
    expect(policyRequests).toHaveLength(0);
    expect(status).toBeLessThan(300);
  });

  it('proceeds with run even when policy registration returns conflict (idempotent)', async () => {
    const request = {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      templateId: 'unanimous',
      inputs: {
        customerId: 'C-888',
        transactionAmount: 25000,
        deviceTrustScore: 0.3,
        accountAgeDays: 30,
        isVipCustomer: false,
        priorChargebacks: 1
      }
    };

    // First run registers the policy
    const { status: status1 } = await ctx.client.requestRaw('POST', '/examples/run', { body: request });
    expect(status1).toBeLessThan(300);

    ctx.mockControlPlane!.clearRequests();

    // Second run should still succeed even though policy already exists (409)
    const { status: status2 } = await ctx.client.requestRaw('POST', '/examples/run', { body: request });
    expect(status2).toBeLessThan(300);
  });

  it('skips registration for dry run', async () => {
    const request = {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      templateId: 'unanimous',
      submitToControlPlane: false,
      inputs: {
        customerId: 'C-777',
        transactionAmount: 10000,
        deviceTrustScore: 0.5,
        accountAgeDays: 60,
        isVipCustomer: false,
        priorChargebacks: 0
      }
    };

    const { status } = await ctx.client.requestRaw('POST', '/examples/run', { body: request });

    expect(status).toBeLessThan(300);
    expect(ctx.mockControlPlane!.policyRequests).toHaveLength(0);
  });
});
