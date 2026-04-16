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

    it('each pack has non-empty slug + name', async () => {
      const packs = await ctx.client.listPacks();
      for (const pack of packs) {
        expect(typeof pack.slug).toBe('string');
        expect(pack.slug.length).toBeGreaterThan(0);
        expect(typeof pack.name).toBe('string');
        expect(pack.name.length).toBeGreaterThan(0);
        if (pack.description !== undefined) {
          expect(typeof pack.description).toBe('string');
        }
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
      expect((schema.formSchema as { type?: string }).type).toBe('object');
      expect((schema.formSchema as { properties?: unknown }).properties).toBeTruthy();
      expect(schema.defaults).toEqual(expect.objectContaining({ transactionAmount: expect.any(Number) }));
      expect(schema.participants).toHaveLength(4);
      expect(schema.agents).toHaveLength(4);
      expect(schema.runtime).toEqual({ kind: 'rust', version: 'v1' });
      expect(schema.expectedDecisionKinds).toEqual(expect.arrayContaining(['approve', 'decline']));
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

    it('each scenario has non-empty packSlug + scenario + name + at least one version + templates array', async () => {
      const { body } = await ctx.client.requestRaw('GET', '/scenarios');
      for (const scenario of body as any[]) {
        expect(typeof scenario.packSlug).toBe('string');
        expect(scenario.packSlug.length).toBeGreaterThan(0);
        expect(typeof scenario.scenario).toBe('string');
        expect(scenario.scenario.length).toBeGreaterThan(0);
        expect(typeof scenario.name).toBe('string');
        expect(scenario.name.length).toBeGreaterThan(0);
        expect(Array.isArray(scenario.versions)).toBe(true);
        expect(scenario.versions.length).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(scenario.templates)).toBe(true);
      }
    });
  });
});
