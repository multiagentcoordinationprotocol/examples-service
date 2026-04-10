import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import { ControlPlaneClient } from '../../src/control-plane/control-plane.client';
import { PolicyDefinition } from '../../src/contracts/policy';
import { AppException } from '../../src/errors/app-exception';

const describeIfMock =
  (process.env.INTEGRATION_CONTROL_PLANE ?? 'mock') === 'mock' ? describe : describe.skip;

function testPolicy(id: string): PolicyDefinition {
  return {
    policy_id: id,
    mode: 'macp.mode.decision.v1',
    schema_version: 1,
    description: `Test policy ${id}`,
    rules: {
      voting: { algorithm: 'majority' as const },
      objection_handling: { critical_severity_vetoes: false, veto_threshold: 1 },
      evaluation: { minimum_confidence: 0, required_before_voting: false },
      commitment: { authority: 'initiator_only' as const, require_vote_quorum: false, designated_roles: [] }
    }
  };
}

describeIfMock('Policy CRUD via ControlPlaneClient (integration, mock-only)', () => {
  let ctx: IntegrationTestContext;
  let cpClient: ControlPlaneClient;

  beforeAll(async () => {
    // Disable auto policy registration so we start with a clean slate
    ctx = await createIntegrationTestApp({ autoBootstrapExampleAgents: false });
    cpClient = ctx.module.get(ControlPlaneClient);
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  afterEach(() => {
    ctx.mockControlPlane!.clearRequests();
  });

  describe('registerPolicy', () => {
    it('registers a new policy successfully', async () => {
      const policy = testPolicy('policy.test.register');
      const result = await cpClient.registerPolicy(policy);
      expect(result.ok).toBe(true);
    });

    it('returns ok=true for duplicate registration (idempotent via 409)', async () => {
      const policy = testPolicy('policy.test.idempotent');
      await cpClient.registerPolicy(policy);
      const result = await cpClient.registerPolicy(policy);
      expect(result.ok).toBe(true);
    });
  });

  describe('listPolicies', () => {
    it('returns registered policies', async () => {
      const policy = testPolicy('policy.test.list');
      await cpClient.registerPolicy(policy);

      const policies = await cpClient.listPolicies();
      const found = policies.find((p) => p.policy_id === 'policy.test.list');
      expect(found).toBeDefined();
    });
  });

  describe('getPolicy', () => {
    it('returns policy by ID after registration', async () => {
      const policy = testPolicy('policy.test.get');
      await cpClient.registerPolicy(policy);

      const result = await cpClient.getPolicy('policy.test.get');
      expect(result.policy_id).toBe('policy.test.get');
      expect(result.mode).toBe('macp.mode.decision.v1');
    });

    it('throws for unknown policy ID', async () => {
      await expect(cpClient.getPolicy('policy.nonexistent')).rejects.toThrow(AppException);
    });
  });

  describe('deletePolicy', () => {
    it('deletes existing policy successfully', async () => {
      const policy = testPolicy('policy.test.delete');
      await cpClient.registerPolicy(policy);

      const result = await cpClient.deletePolicy('policy.test.delete');
      expect(result.ok).toBe(true);
    });

    it('throws for unknown policy ID', async () => {
      await expect(cpClient.deletePolicy('policy.does-not-exist')).rejects.toThrow(AppException);
    });

    it('policy is no longer returned by getPolicy after deletion', async () => {
      const policy = testPolicy('policy.test.delete-verify');
      await cpClient.registerPolicy(policy);
      await cpClient.deletePolicy('policy.test.delete-verify');

      await expect(cpClient.getPolicy('policy.test.delete-verify')).rejects.toThrow(AppException);
    });
  });

  describe('full lifecycle', () => {
    it('register -> list -> get -> delete -> verify gone', async () => {
      const policyId = 'policy.test.lifecycle';
      const policy = testPolicy(policyId);

      // Register
      const regResult = await cpClient.registerPolicy(policy);
      expect(regResult.ok).toBe(true);

      // List — should include our policy
      const listed = await cpClient.listPolicies();
      expect(listed.some((p) => p.policy_id === policyId)).toBe(true);

      // Get — should return details
      const fetched = await cpClient.getPolicy(policyId);
      expect(fetched.policy_id).toBe(policyId);
      expect(fetched.description).toBe(`Test policy ${policyId}`);

      // Delete
      const delResult = await cpClient.deletePolicy(policyId);
      expect(delResult.ok).toBe(true);

      // Verify gone — list should no longer include it
      const listedAfter = await cpClient.listPolicies();
      expect(listedAfter.some((p) => p.policy_id === policyId)).toBe(false);

      // Verify gone — get should throw
      await expect(cpClient.getPolicy(policyId)).rejects.toThrow(AppException);
    });
  });
});
