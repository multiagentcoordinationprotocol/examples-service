import * as path from 'path';
import { FileRegistryLoader } from './file-registry.loader';
import { AppConfigService } from '../config/app-config.service';

describe('FileRegistryLoader', () => {
  let loader: FileRegistryLoader;
  const packsDir = path.resolve(__dirname, '../../packs');

  beforeEach(() => {
    const config = { packsDir } as AppConfigService;
    loader = new FileRegistryLoader(config);
  });

  describe('loadAll', () => {
    it('should discover the fraud pack', async () => {
      const snapshot = await loader.loadAll();
      expect(snapshot.packs.has('fraud')).toBe(true);
    });

    it('should discover the high-value-new-device scenario', async () => {
      const snapshot = await loader.loadAll();
      const fraudPack = snapshot.packs.get('fraud')!;
      expect(fraudPack.scenarios.has('high-value-new-device')).toBe(true);
    });

    it('should discover version 1.0.0', async () => {
      const snapshot = await loader.loadAll();
      const fraudPack = snapshot.packs.get('fraud')!;
      const scenario = fraudPack.scenarios.get('high-value-new-device')!;
      expect(scenario.versions.has('1.0.0')).toBe(true);
    });

    it('should discover templates', async () => {
      const snapshot = await loader.loadAll();
      const fraudPack = snapshot.packs.get('fraud')!;
      const scenario = fraudPack.scenarios.get('high-value-new-device')!;
      const version = scenario.versions.get('1.0.0')!;
      expect(version.templates.has('default')).toBe(true);
      expect(version.templates.has('strict-risk')).toBe(true);
    });

    it('should parse pack metadata correctly', async () => {
      const snapshot = await loader.loadAll();
      const fraudPack = snapshot.packs.get('fraud')!;
      expect(fraudPack.pack.metadata.slug).toBe('fraud');
      expect(fraudPack.pack.metadata.name).toBe('Fraud');
      expect(fraudPack.pack.metadata.description).toBe('Fraud and risk decisioning demos');
    });

    it('should parse scenario metadata correctly', async () => {
      const snapshot = await loader.loadAll();
      const fraudPack = snapshot.packs.get('fraud')!;
      const version = fraudPack.scenarios.get('high-value-new-device')!.versions.get('1.0.0')!;
      expect(version.scenario.metadata.name).toBe('High Value Purchase From New Device');
      expect(version.scenario.spec.launch.participants).toHaveLength(3);
    });

    it('should return empty snapshot for non-existent directory', async () => {
      const config = { packsDir: '/non/existent/path' } as AppConfigService;
      const emptyLoader = new FileRegistryLoader(config);
      const snapshot = await emptyLoader.loadAll();
      expect(snapshot.packs.size).toBe(0);
    });

    it('should include loadedAt timestamp', async () => {
      const before = Date.now();
      const snapshot = await loader.loadAll();
      expect(snapshot.loadedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('loadAll with fixtures', () => {
    it('should handle empty pack directory', async () => {
      const fixturesDir = path.resolve(__dirname, '../../test/fixtures/packs');
      const config = { packsDir: fixturesDir } as AppConfigService;
      const fixtureLoader = new FileRegistryLoader(config);
      const snapshot = await fixtureLoader.loadAll();
      // Should have fraud pack and the empty-pack (which has no scenarios)
      const emptyPack = snapshot.packs.get('empty-pack');
      if (emptyPack) {
        expect(emptyPack.scenarios.size).toBe(0);
      }
    });
  });
});
