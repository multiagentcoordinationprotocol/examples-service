import { LaunchService } from './launch.service';
import { RegistryIndexService } from '../registry/registry-index.service';
import { ScenarioVersionFile, ScenarioTemplateFile } from '../contracts/registry';

const mockScenario: ScenarioVersionFile = {
  apiVersion: 'scenarios.macp.dev/v1',
  kind: 'ScenarioVersion',
  metadata: { pack: 'fraud', scenario: 'test', version: '1.0.0', name: 'Test Scenario' },
  spec: {
    inputs: {
      schema: {
        type: 'object',
        properties: {
          amount: { type: 'number', default: 100 },
          name: { type: 'string' }
        }
      }
    },
    launch: {
      modeName: 'test.mode',
      modeVersion: '1.0.0',
      configurationVersion: '1.0.0',
      ttlMs: 300000,
      participants: [{ id: 'agent-1', role: 'tester', agentRef: 'agent-1' }]
    },
    outputs: { expectedDecisionKinds: ['approve', 'decline'] }
  }
};

const mockTemplate: ScenarioTemplateFile = {
  apiVersion: 'scenarios.macp.dev/v1',
  kind: 'ScenarioTemplate',
  metadata: { scenarioVersion: 'fraud/test@1.0.0', slug: 'strict', name: 'Strict' },
  spec: {
    defaults: { amount: 200 },
    overrides: { launch: { ttlMs: 180000 } }
  }
};

describe('LaunchService', () => {
  let service: LaunchService;
  let mockIndex: jest.Mocked<RegistryIndexService>;

  beforeEach(() => {
    mockIndex = {
      getScenarioVersion: jest.fn(),
      getTemplate: jest.fn()
    } as unknown as jest.Mocked<RegistryIndexService>;
    service = new LaunchService(mockIndex);
  });

  describe('getLaunchSchema', () => {
    it('should return launch schema with schema defaults', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      const result = await service.getLaunchSchema('fraud', 'test', '1.0.0');

      expect(result.scenarioRef).toBe('fraud/test@1.0.0');
      expect(result.defaults).toEqual({ amount: 100 });
      expect(result.formSchema).toBe(mockScenario.spec.inputs.schema);
      expect(result.participants).toHaveLength(1);
      expect(result.launchSummary.ttlMs).toBe(300000);
      expect(result.expectedDecisionKinds).toEqual(['approve', 'decline']);
    });

    it('should merge template defaults over schema defaults', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      mockIndex.getTemplate.mockResolvedValue(mockTemplate);
      const result = await service.getLaunchSchema('fraud', 'test', '1.0.0', 'strict');

      expect(result.defaults.amount).toBe(200);
      expect(result.templateId).toBe('strict');
    });

    it('should apply template launch overrides', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      mockIndex.getTemplate.mockResolvedValue(mockTemplate);
      const result = await service.getLaunchSchema('fraud', 'test', '1.0.0', 'strict');

      expect(result.launchSummary.ttlMs).toBe(180000);
    });

    it('should not set templateId when no template requested', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      const result = await service.getLaunchSchema('fraud', 'test', '1.0.0');
      expect(result.templateId).toBeUndefined();
    });

    it('should propagate NOT_FOUND errors', async () => {
      mockIndex.getScenarioVersion.mockRejectedValue(new Error('not found'));
      await expect(service.getLaunchSchema('fraud', 'test', '1.0.0')).rejects.toThrow();
    });
  });
});
