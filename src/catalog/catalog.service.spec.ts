import { CatalogService } from './catalog.service';
import { RegistryIndexService } from '../registry/registry-index.service';
import { PackEntry, RegistrySnapshot, ScenarioVersionFile, ScenarioTemplateFile } from '../contracts/registry';

function createMockSnapshot(): RegistrySnapshot {
  const scenario: ScenarioVersionFile = {
    apiVersion: 'scenarios.macp.dev/v1',
    kind: 'ScenarioVersion',
    metadata: { pack: 'fraud', scenario: 'test-scenario', version: '1.0.0', name: 'Test Scenario', summary: 'A test', tags: ['tag1'] },
    spec: {
      inputs: { schema: {} },
      launch: { modeName: 'mode', modeVersion: '1.0.0', configurationVersion: '1.0.0', ttlMs: 60000, participants: [] }
    }
  };

  const template: ScenarioTemplateFile = {
    apiVersion: 'scenarios.macp.dev/v1',
    kind: 'ScenarioTemplate',
    metadata: { scenarioVersion: 'fraud/test-scenario@1.0.0', slug: 'default', name: 'Default' },
    spec: {}
  };

  const packs = new Map<string, PackEntry>();
  packs.set('fraud', {
    pack: { apiVersion: 'scenarios.macp.dev/v1', kind: 'ScenarioPack', metadata: { slug: 'fraud', name: 'Fraud', description: 'Fraud demos', tags: ['fraud'] } },
    scenarios: new Map([
      ['test-scenario', { versions: new Map([['1.0.0', { scenario, templates: new Map([['default', template]]) }]]) }]
    ])
  });

  return { packs, loadedAt: Date.now() };
}

describe('CatalogService', () => {
  let service: CatalogService;
  let mockIndex: jest.Mocked<RegistryIndexService>;

  beforeEach(() => {
    mockIndex = {
      getSnapshot: jest.fn(),
      getPack: jest.fn()
    } as unknown as jest.Mocked<RegistryIndexService>;
    service = new CatalogService(mockIndex);
  });

  describe('listPacks', () => {
    it('should return all pack summaries', async () => {
      mockIndex.getSnapshot.mockResolvedValue(createMockSnapshot());
      const result = await service.listPacks();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        slug: 'fraud',
        name: 'Fraud',
        description: 'Fraud demos',
        tags: ['fraud']
      });
    });

    it('should return empty array when no packs', async () => {
      mockIndex.getSnapshot.mockResolvedValue({ packs: new Map(), loadedAt: Date.now() });
      const result = await service.listPacks();
      expect(result).toEqual([]);
    });
  });

  describe('listScenarios', () => {
    it('should return scenarios for a pack', async () => {
      const snapshot = createMockSnapshot();
      mockIndex.getPack.mockResolvedValue(snapshot.packs.get('fraud')!);
      const result = await service.listScenarios('fraud');
      expect(result).toHaveLength(1);
      expect(result[0].scenario).toBe('test-scenario');
      expect(result[0].name).toBe('Test Scenario');
      expect(result[0].versions).toEqual(['1.0.0']);
      expect(result[0].templates).toEqual(['default']);
      expect(result[0].tags).toEqual(['tag1']);
    });

    it('should propagate PACK_NOT_FOUND from index service', async () => {
      mockIndex.getPack.mockRejectedValue(new Error('PACK_NOT_FOUND'));
      await expect(service.listScenarios('nonexistent')).rejects.toThrow();
    });
  });
});
