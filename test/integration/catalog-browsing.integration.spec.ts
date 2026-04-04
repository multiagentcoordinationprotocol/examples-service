import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';

describe('Catalog Browsing (integration)', () => {
  let ctx: IntegrationTestContext;

  beforeAll(async () => {
    ctx = await createIntegrationTestApp();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  describe('GET /packs', () => {
    it('returns all available packs', async () => {
      const packs = await ctx.client.listPacks();
      expect(packs.length).toBeGreaterThanOrEqual(3);

      const slugs = packs.map((p) => p.slug);
      expect(slugs).toContain('fraud');
      expect(slugs).toContain('lending');
      expect(slugs).toContain('claims');
    });

    it('each pack has slug and name', async () => {
      const packs = await ctx.client.listPacks();
      for (const pack of packs) {
        expect(pack.slug).toBeDefined();
        expect(pack.name).toBeDefined();
      }
    });
  });

  describe('GET /packs/:packSlug/scenarios', () => {
    it('returns scenarios for fraud pack', async () => {
      const scenarios = await ctx.client.listScenarios('fraud');
      expect(scenarios.length).toBeGreaterThanOrEqual(1);

      const first = scenarios[0];
      expect(first.scenario).toBe('high-value-new-device');
      expect(first.versions).toContain('1.0.0');
      expect(first.templates).toContain('default');
    });

    it('returns scenarios for lending pack', async () => {
      const scenarios = await ctx.client.listScenarios('lending');
      expect(scenarios.length).toBeGreaterThanOrEqual(1);
      expect(scenarios[0].scenario).toBe('loan-underwriting');
    });

    it('returns scenarios for claims pack', async () => {
      const scenarios = await ctx.client.listScenarios('claims');
      expect(scenarios.length).toBeGreaterThanOrEqual(1);
      expect(scenarios[0].scenario).toBe('auto-claim-review');
    });

    it('returns 404 for nonexistent pack', async () => {
      const { status, body } = await ctx.client.requestRaw('GET', '/packs/nonexistent/scenarios');
      expect(status).toBe(404);
      expect(body).toHaveProperty('errorCode', 'PACK_NOT_FOUND');
    });
  });

  describe('Launch Schema', () => {
    it('returns launch schema for fraud scenario', async () => {
      const schema = await ctx.client.getLaunchSchema('fraud', 'high-value-new-device', '1.0.0');
      expect(schema.scenarioRef).toBe('fraud/high-value-new-device@1.0.0');
      expect(schema.formSchema).toBeDefined();
      expect(schema.defaults).toBeDefined();
      expect(schema.participants).toHaveLength(4);
      expect(schema.agents).toHaveLength(4);
      expect(schema.runtime).toEqual({ kind: 'rust', version: 'v1' });
      expect(schema.expectedDecisionKinds).toBeDefined();
    });

    it('returns template-specific schema with ?template=strict-risk', async () => {
      const schema = await ctx.client.getLaunchSchema('fraud', 'high-value-new-device', '1.0.0', 'strict-risk');
      expect(schema.templateId).toBe('strict-risk');
      expect((schema.defaults as any).deviceTrustScore).toBe(0.08);
    });

    it('returns 404 for nonexistent template', async () => {
      const { status, body } = await ctx.client.requestRaw(
        'GET',
        '/packs/fraud/scenarios/high-value-new-device/versions/1.0.0/launch-schema?template=nonexistent'
      );
      expect(status).toBe(404);
      expect(body).toHaveProperty('errorCode', 'TEMPLATE_NOT_FOUND');
    });

    it('returns 404 for nonexistent version', async () => {
      const { status, body } = await ctx.client.requestRaw(
        'GET',
        '/packs/fraud/scenarios/high-value-new-device/versions/9.9.9/launch-schema'
      );
      expect(status).toBe(404);
      expect(body).toHaveProperty('errorCode', 'VERSION_NOT_FOUND');
    });
  });

  describe('GET /scenarios (cross-pack)', () => {
    it('returns all scenarios across all packs', async () => {
      const { status, body } = await ctx.client.requestRaw('GET', '/scenarios');
      expect(status).toBe(200);

      const scenarios = body as any[];
      expect(scenarios.length).toBeGreaterThanOrEqual(3);

      const packSlugs = [...new Set(scenarios.map((s: any) => s.packSlug))];
      expect(packSlugs).toContain('fraud');
      expect(packSlugs).toContain('lending');
      expect(packSlugs).toContain('claims');
    });

    it('each scenario has packSlug and standard fields', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/scenarios');
      for (const scenario of body as any[]) {
        expect(scenario.packSlug).toBeDefined();
        expect(scenario.scenario).toBeDefined();
        expect(scenario.name).toBeDefined();
        expect(scenario.versions).toBeDefined();
        expect(scenario.templates).toBeDefined();
      }
    });
  });
});
