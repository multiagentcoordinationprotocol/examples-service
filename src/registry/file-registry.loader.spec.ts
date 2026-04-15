import * as fs from 'fs';
import * as os from 'os';
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
      expect(version.scenario.spec.launch.participants).toHaveLength(4);
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

  describe('loadAll with shared fragments', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-shared-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('skips _-prefixed top-level directories during pack discovery', async () => {
      // Create a normal pack
      fs.mkdirSync(path.join(tmpDir, 'normal'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'normal/pack.yaml'),
        'apiVersion: scenarios.macp.dev/v1\nkind: ScenarioPack\nmetadata:\n  slug: normal\n  name: Normal\n'
      );
      // And a _shared sibling that should be ignored even though it has a pack.yaml
      fs.mkdirSync(path.join(tmpDir, '_shared'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '_shared/pack.yaml'),
        'apiVersion: scenarios.macp.dev/v1\nkind: ScenarioPack\nmetadata:\n  slug: should-not-load\n  name: Hidden\n'
      );

      const config = { packsDir: tmpDir } as AppConfigService;
      const sharedLoader = new FileRegistryLoader(config);
      const snapshot = await sharedLoader.loadAll();

      expect(snapshot.packs.has('normal')).toBe(true);
      expect(snapshot.packs.has('should-not-load')).toBe(false);
      expect(snapshot.packs.size).toBe(1);
    });

    it('inlines !include fragments at load time', async () => {
      // _shared fragment
      fs.mkdirSync(path.join(tmpDir, '_shared/participants'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '_shared/participants/duo.yaml'),
        '- id: a\n  role: r1\n  agentRef: a\n- id: b\n  role: r2\n  agentRef: b\n'
      );
      // pack
      fs.mkdirSync(path.join(tmpDir, 'demo/scenarios/x/1.0.0/templates'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'demo/pack.yaml'),
        'apiVersion: scenarios.macp.dev/v1\nkind: ScenarioPack\nmetadata:\n  slug: demo\n  name: Demo\n'
      );
      fs.writeFileSync(
        path.join(tmpDir, 'demo/scenarios/x/1.0.0/scenario.yaml'),
        `apiVersion: scenarios.macp.dev/v1
kind: ScenarioVersion
metadata:
  pack: demo
  scenario: x
  version: 1.0.0
  name: X
spec:
  runtime: { kind: rust, version: v1 }
  inputs:
    schema: { type: object }
  launch:
    modeName: m
    modeVersion: '1'
    configurationVersion: c
    ttlMs: 1000
    participants: !include ../../../../_shared/participants/duo.yaml
`
      );
      fs.writeFileSync(
        path.join(tmpDir, 'demo/scenarios/x/1.0.0/templates/default.yaml'),
        'apiVersion: scenarios.macp.dev/v1\nkind: ScenarioTemplate\nmetadata:\n  scenarioVersion: demo/x@1.0.0\n  slug: default\n  name: Default\nspec: {}\n'
      );

      const config = { packsDir: tmpDir } as AppConfigService;
      const includingLoader = new FileRegistryLoader(config);
      const snapshot = await includingLoader.loadAll();

      const version = snapshot.packs.get('demo')?.scenarios.get('x')?.versions.get('1.0.0');
      expect(version?.scenario.spec.launch.participants).toEqual([
        { id: 'a', role: 'r1', agentRef: 'a' },
        { id: 'b', role: 'r2', agentRef: 'b' }
      ]);
    });
  });
});
