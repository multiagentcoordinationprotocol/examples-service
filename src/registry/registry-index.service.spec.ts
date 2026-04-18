import { RegistryIndexService } from './registry-index.service';
import { FileRegistryLoader } from './file-registry.loader';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import { RegistrySnapshot, PackEntry, ScenarioVersionFile, ScenarioTemplateFile } from '../contracts/registry';

function createMockSnapshot(): RegistrySnapshot {
  const template: ScenarioTemplateFile = {
    apiVersion: 'scenarios.macp.dev/v1',
    kind: 'ScenarioTemplate',
    metadata: { scenarioVersion: 'test/scenario@1.0.0', slug: 'default', name: 'Default' },
    spec: { defaults: { amount: 100 } }
  };

  const scenario: ScenarioVersionFile = {
    apiVersion: 'scenarios.macp.dev/v1',
    kind: 'ScenarioVersion',
    metadata: { pack: 'test', scenario: 'scenario', version: '1.0.0', name: 'Test Scenario' },
    spec: {
      inputs: { schema: { type: 'object', properties: {} } },
      launch: {
        modeName: 'test.mode',
        modeVersion: '1.0.0',
        configurationVersion: '1.0.0',
        ttlMs: 60000,
        participants: [{ id: 'agent-1', role: 'tester', agentRef: 'agent-1' }]
      }
    }
  };

  const packs = new Map<string, PackEntry>();
  packs.set('test', {
    pack: {
      apiVersion: 'scenarios.macp.dev/v1',
      kind: 'ScenarioPack',
      metadata: { slug: 'test', name: 'Test Pack' }
    },
    scenarios: new Map([
      [
        'scenario',
        {
          versions: new Map([['1.0.0', { scenario, templates: new Map([['default', template]]) }]])
        }
      ]
    ])
  });

  return { packs, loadedAt: Date.now() };
}

describe('RegistryIndexService', () => {
  let service: RegistryIndexService;
  let mockLoader: jest.Mocked<FileRegistryLoader>;
  let mockConfig: AppConfigService;

  beforeEach(() => {
    mockLoader = { loadAll: jest.fn() } as unknown as jest.Mocked<FileRegistryLoader>;
    mockConfig = { registryCacheTtlMs: 0 } as AppConfigService;
    service = new RegistryIndexService(mockLoader, mockConfig);
  });

  describe('getSnapshot', () => {
    it('should load from loader on first call', async () => {
      const snapshot = createMockSnapshot();
      mockLoader.loadAll.mockResolvedValue(snapshot);
      const result = await service.getSnapshot();
      expect(result).toBe(snapshot);
      expect(mockLoader.loadAll).toHaveBeenCalledTimes(1);
    });

    it('should reload every time when cacheTtlMs is 0', async () => {
      const snapshot1 = createMockSnapshot();
      const snapshot2 = createMockSnapshot();
      mockLoader.loadAll.mockResolvedValueOnce(snapshot1).mockResolvedValueOnce(snapshot2);

      await service.getSnapshot();
      await service.getSnapshot();
      expect(mockLoader.loadAll).toHaveBeenCalledTimes(2);
    });

    it('should use cache when cacheTtlMs > 0 and cache is fresh', async () => {
      const cachedConfig = { registryCacheTtlMs: 60000 } as AppConfigService;
      const cachedService = new RegistryIndexService(mockLoader, cachedConfig);

      const snapshot = createMockSnapshot();
      mockLoader.loadAll.mockResolvedValue(snapshot);

      await cachedService.getSnapshot();
      await cachedService.getSnapshot();
      expect(mockLoader.loadAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPack', () => {
    it('should return pack by slug', async () => {
      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());
      const pack = await service.getPack('test');
      expect(pack.pack.metadata.slug).toBe('test');
    });

    it('should throw PACK_NOT_FOUND for unknown slug', async () => {
      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());
      try {
        await service.getPack('nonexistent');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).errorCode).toBe(ErrorCode.PACK_NOT_FOUND);
      }
    });
  });

  describe('getScenarioVersion', () => {
    it('should return scenario version', async () => {
      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());
      const scenario = await service.getScenarioVersion('test', 'scenario', '1.0.0');
      expect(scenario.metadata.name).toBe('Test Scenario');
    });

    it('should throw SCENARIO_NOT_FOUND for unknown scenario', async () => {
      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());
      try {
        await service.getScenarioVersion('test', 'nonexistent', '1.0.0');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).errorCode).toBe(ErrorCode.SCENARIO_NOT_FOUND);
      }
    });

    it('should throw VERSION_NOT_FOUND for unknown version', async () => {
      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());
      try {
        await service.getScenarioVersion('test', 'scenario', '9.9.9');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).errorCode).toBe(ErrorCode.VERSION_NOT_FOUND);
      }
    });
  });

  describe('getTemplate', () => {
    it('should return template by slug', async () => {
      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());
      const template = await service.getTemplate('test', 'scenario', '1.0.0', 'default');
      expect(template.metadata.slug).toBe('default');
    });

    it('should throw TEMPLATE_NOT_FOUND for unknown template', async () => {
      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());
      try {
        await service.getTemplate('test', 'scenario', '1.0.0', 'nonexistent');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).errorCode).toBe(ErrorCode.TEMPLATE_NOT_FOUND);
      }
    });
  });

  describe('invalidate', () => {
    it('should clear cache and force reload', async () => {
      const cachedConfig = { registryCacheTtlMs: 60000 } as AppConfigService;
      const cachedService = new RegistryIndexService(mockLoader, cachedConfig);

      mockLoader.loadAll.mockResolvedValue(createMockSnapshot());

      await cachedService.getSnapshot();
      cachedService.invalidate();
      await cachedService.getSnapshot();

      expect(mockLoader.loadAll).toHaveBeenCalledTimes(2);
    });
  });
});
