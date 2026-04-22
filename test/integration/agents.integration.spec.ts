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

    it('each agent has the expected non-empty fields', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/agents');
      const validFrameworks = ['langgraph', 'langchain', 'crewai', 'custom'] as const;
      const validStrategies = ['external', 'in-memory'] as const;
      const validModes = ['attached', 'deferred'] as const;

      for (const agent of body as any[]) {
        expect(typeof agent.agentRef).toBe('string');
        expect(agent.agentRef.length).toBeGreaterThan(0);
        expect(typeof agent.name).toBe('string');
        expect(agent.name.length).toBeGreaterThan(0);
        expect(['fraud', 'growth', 'compliance', 'coordinator', 'risk']).toContain(agent.role);
        expect(validFrameworks).toContain(agent.framework);
        expect(agent.transportIdentity).toBe(`agent://${agent.agentRef}`);
        expect(typeof agent.entrypoint).toBe('string');
        expect(agent.entrypoint.length).toBeGreaterThan(0);
        expect(validStrategies).toContain(agent.bootstrapStrategy);
        expect(validModes).toContain(agent.bootstrapMode);
        expect(Array.isArray(agent.scenarios)).toBe(true);
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
        expect(typeof agent.description).toBe('string');
        expect(agent.description.length).toBeGreaterThan(0);
      }
    });

    it('agents have scenario coverage', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/agents');
      for (const agent of body as any[]) {
        expect(agent.scenarios.length).toBeGreaterThanOrEqual(1);
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
        ...fraudScenarioRunRequest(),
        tags: ['ui-launch', 'experiment-42'],
        runLabel: 'My test run'
      })) as any;

      const execution = result.compiled.runDescriptor.execution;
      expect(execution.tags).toContain('ui-launch');
      expect(execution.tags).toContain('experiment-42');
      expect(execution.tags).toContain('example');

      const metadata = result.compiled.runDescriptor.session.metadata;
      expect(metadata.runLabel).toBe('My test run');
    });

    it('overrides requester when provided', async () => {
      const result = (await ctx.client.runExample({
        ...fraudScenarioRunRequest(),
        requester: { actorId: 'user@example.com', actorType: 'user' }
      })) as any;

      const requester = result.compiled.runDescriptor.execution.requester;
      expect(requester.actorId).toBe('user@example.com');
      expect(requester.actorType).toBe('user');
    });
  });
});
