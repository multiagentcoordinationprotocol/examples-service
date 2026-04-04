import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import { fraudScenarioRunRequest } from '../fixtures/integration-requests';

describe('Agents (integration)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  describe('GET /agents', () => {
    it('returns all 4 agent profiles', async () => {
      const { status, body } = await ctx.client.requestRaw('GET', '/agents');
      expect(status).toBe(200);
      expect(body).toHaveLength(4);
    });

    it('each agent has correct fields', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/agents');
      for (const agent of body as any[]) {
        expect(agent.agentRef).toBeDefined();
        expect(agent.name).toBeDefined();
        expect(agent.role).toBeDefined();
        expect(agent.framework).toBeDefined();
        expect(agent.transportIdentity).toContain('agent://');
        expect(agent.entrypoint).toBeDefined();
        expect(agent.bootstrapStrategy).toBeDefined();
        expect(agent.bootstrapMode).toBeDefined();
        expect(agent.scenarios).toBeDefined();
        expect(Array.isArray(agent.scenarios)).toBe(true);
        expect(agent.metrics).toBeDefined();
      }
    });

    it('returns correct frameworks', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/agents');
      const frameworks = (body as any[]).map((a: any) => a.framework).sort();
      expect(frameworks).toEqual(['crewai', 'custom', 'langchain', 'langgraph']);
    });

    it('each agent covers all 3 scenario packs', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/agents');
      for (const agent of body as any[]) {
        expect(agent.scenarios.length).toBeGreaterThanOrEqual(3);
        const packs = agent.scenarios.map((s: string) => s.split('/')[0]);
        expect(packs).toContain('fraud');
        expect(packs).toContain('lending');
        expect(packs).toContain('claims');
      }
    });

    it('agents have descriptions', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/agents');
      for (const agent of body as any[]) {
        expect(agent.description).toBeDefined();
        expect(typeof agent.description).toBe('string');
      }
    });

    it('agents have zero metrics', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/agents');
      for (const agent of body as any[]) {
        expect(agent.metrics.runs).toBe(0);
        expect(agent.metrics.signals).toBe(0);
        expect(agent.metrics.averageLatencyMs).toBe(0);
        expect(agent.metrics.averageConfidence).toBe(0);
      }
    });
  });

  describe('GET /agents/:agentRef', () => {
    it('returns fraud-agent profile', async () => {
      const { status, body } = await ctx.client.requestRaw('GET', '/agents/fraud-agent');
      expect(status).toBe(200);
      const agent = body as any;
      expect(agent.agentRef).toBe('fraud-agent');
      expect(agent.name).toBe('Fraud Agent');
      expect(agent.framework).toBe('langgraph');
      expect(agent.scenarios.length).toBeGreaterThanOrEqual(3);
    });

    it('returns 404 for nonexistent agent', async () => {
      const { status, body } = await ctx.client.requestRaw('GET', '/agents/nonexistent');
      expect(status).toBe(404);
      expect(body).toHaveProperty('errorCode', 'AGENT_NOT_FOUND');
    });
  });

  describe('GET /scenarios (cross-pack)', () => {
    it('returns all scenarios with packSlug', async () => {
      const { status, body } = await ctx.client.requestRaw('GET', '/scenarios');
      expect(status).toBe(200);
      const scenarios = body as any[];
      expect(scenarios.length).toBeGreaterThanOrEqual(3);

      const packSlugs = [...new Set(scenarios.map((s: any) => s.packSlug))];
      expect(packSlugs).toContain('fraud');
      expect(packSlugs).toContain('lending');
      expect(packSlugs).toContain('claims');

      for (const scenario of scenarios) {
        expect(scenario.packSlug).toBeDefined();
        expect(scenario.scenario).toBeDefined();
        expect(scenario.name).toBeDefined();
        expect(scenario.versions).toBeDefined();
      }
    });
  });

  describe('POST /examples/run with tags and runLabel', () => {
    it('merges user-provided tags into execution request', async () => {
      const result = (await ctx.client.runExample({
        ...fraudScenarioRunRequest({ submitToControlPlane: false }),
        tags: ['ui-launch', 'experiment-42'],
        runLabel: 'My test run'
      })) as any;

      const execution = result.compiled.executionRequest.execution;
      expect(execution.tags).toContain('ui-launch');
      expect(execution.tags).toContain('experiment-42');
      expect(execution.tags).toContain('example');

      const metadata = result.compiled.executionRequest.session.metadata;
      expect(metadata.runLabel).toBe('My test run');
    });

    it('overrides requester when provided', async () => {
      const result = (await ctx.client.runExample({
        ...fraudScenarioRunRequest({ submitToControlPlane: false }),
        requester: { actorId: 'user@example.com', actorType: 'user' }
      })) as any;

      const requester = result.compiled.executionRequest.execution.requester;
      expect(requester.actorId).toBe('user@example.com');
      expect(requester.actorType).toBe('user');
    });
  });
});
