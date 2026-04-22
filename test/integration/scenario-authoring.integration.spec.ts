import { createIntegrationTestApp, IntegrationTestContext } from '../helpers/integration-test-app';
import { fraudScenarioCompileRequest } from '../fixtures/integration-requests';

describe('Scenario authoring (integration)', () => {
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

  describe('!include propagation through HTTP path', () => {
    it('inlines _shared/metadata fragments through compile', async () => {
      // The fraud fixture's `metadataTemplate` uses `!include` to pull in a
      // shared fragment at load time. Compile resolves it and surfaces the
      // inlined values in runDescriptor.session.metadata.
      const result = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      const metadata = result.runDescriptor.session.metadata;
      expect(metadata.source).toBe('example-service');
      expect(metadata.scenarioRef).toBe('fraud/high-value-new-device@1.0.0');
    });

    it('produces identical compiled output for repeated calls (loader is deterministic with includes)', async () => {
      const a = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      const b = (await ctx.client.compile(fraudScenarioCompileRequest())) as any;
      expect(a.runDescriptor.session.participants).toEqual(b.runDescriptor.session.participants);
      expect(a.scenarioMeta.sessionContext).toEqual(b.scenarioMeta.sessionContext);
    });
  });
});
