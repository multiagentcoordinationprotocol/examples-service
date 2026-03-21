import { CompilerService } from './compiler.service';
import { RegistryIndexService } from '../registry/registry-index.service';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
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
          amount: { type: 'number', default: 100, minimum: 1 },
          isVip: { type: 'boolean', default: true }
        },
        required: ['amount', 'isVip']
      }
    },
    launch: {
      modeName: 'test.mode',
      modeVersion: '1.0.0',
      configurationVersion: '1.0.0',
      ttlMs: 300000,
      participants: [{ id: 'agent-1', role: 'tester', agentRef: 'agent-1' }],
      contextTemplate: {
        amount: '{{ inputs.amount }}',
        isVip: '{{ inputs.isVip }}'
      },
      metadataTemplate: {
        demoType: 'test'
      },
      kickoffTemplate: [
        { from: 'system', to: ['agent-1'], kind: 'request', payload: { goal: 'test' } }
      ]
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
    overrides: {
      launch: {
        ttlMs: 180000,
        metadataTemplate: { demoType: 'test', posture: 'strict' }
      }
    }
  }
};

describe('CompilerService', () => {
  let service: CompilerService;
  let mockIndex: jest.Mocked<RegistryIndexService>;

  beforeEach(() => {
    mockIndex = {
      getScenarioVersion: jest.fn(),
      getTemplate: jest.fn()
    } as unknown as jest.Mocked<RegistryIndexService>;
    service = new CompilerService(mockIndex);
  });

  describe('compile - happy path', () => {
    it('should compile valid inputs into an ExecutionRequest', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        inputs: { amount: 500, isVip: false }
      });

      expect(result.executionRequest.mode).toBe('sandbox');
      expect(result.executionRequest.runtime).toEqual({ kind: 'default' });
      expect(result.executionRequest.session.modeName).toBe('test.mode');
      expect(result.executionRequest.session.ttlMs).toBe(300000);
      expect(result.executionRequest.session.participants).toHaveLength(1);
      expect(result.executionRequest.session.context).toEqual({ amount: 500, isVip: false });
      expect(result.executionRequest.session.metadata?.source).toBe('scenario-registry');
      expect(result.executionRequest.kickoff).toHaveLength(1);
      expect(result.display.title).toBe('Test Scenario');
      expect(result.display.expectedDecisionKinds).toEqual(['approve', 'decline']);
    });

    it('should default mode to sandbox', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        inputs: { amount: 100, isVip: true }
      });
      expect(result.executionRequest.mode).toBe('sandbox');
    });

    it('should use specified mode', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        inputs: { amount: 100, isVip: true },
        mode: 'live'
      });
      expect(result.executionRequest.mode).toBe('live');
    });
  });

  describe('compile - merge precedence', () => {
    it('should merge: schema defaults < template defaults < user inputs', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      mockIndex.getTemplate.mockResolvedValue(mockTemplate);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        templateId: 'strict',
        inputs: { amount: 999, isVip: false }
      });

      // User input wins over template default (200) and schema default (100)
      expect(result.executionRequest.session.context).toEqual({ amount: 999, isVip: false });
    });

    it('should use template defaults when user does not override', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      mockIndex.getTemplate.mockResolvedValue(mockTemplate);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        templateId: 'strict',
        inputs: { isVip: true } // amount not provided, should use template default 200
      });

      expect(result.executionRequest.session.context).toEqual({ amount: 200, isVip: true });
    });

    it('should use schema defaults when neither template nor user provides', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        inputs: {} // both use schema defaults
      });

      expect(result.executionRequest.session.context).toEqual({ amount: 100, isVip: true });
    });
  });

  describe('compile - template overrides', () => {
    it('should apply template ttlMs override', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      mockIndex.getTemplate.mockResolvedValue(mockTemplate);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        templateId: 'strict',
        inputs: { amount: 100, isVip: true }
      });

      expect(result.executionRequest.session.ttlMs).toBe(180000);
    });

    it('should merge template metadata overrides', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      mockIndex.getTemplate.mockResolvedValue(mockTemplate);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        templateId: 'strict',
        inputs: { amount: 100, isVip: true }
      });

      expect(result.executionRequest.session.metadata?.posture).toBe('strict');
      expect(result.executionRequest.session.metadata?.demoType).toBe('test');
    });
  });

  describe('compile - validation errors', () => {
    it('should throw VALIDATION_ERROR for invalid input types', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);

      try {
        await service.compile({
          scenarioRef: 'fraud/test@1.0.0',
          inputs: { amount: 'not-a-number', isVip: true }
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });

    it('should throw VALIDATION_ERROR for out-of-range values', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);

      try {
        await service.compile({
          scenarioRef: 'fraud/test@1.0.0',
          inputs: { amount: -5, isVip: true }
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).errorCode).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });
  });

  describe('compile - error cases', () => {
    it('should throw INVALID_SCENARIO_REF for malformed ref', async () => {
      try {
        await service.compile({
          scenarioRef: 'bad-ref',
          inputs: {}
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppException);
        expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_SCENARIO_REF);
      }
    });

    it('should propagate SCENARIO_NOT_FOUND', async () => {
      mockIndex.getScenarioVersion.mockRejectedValue(
        new AppException(ErrorCode.SCENARIO_NOT_FOUND, 'not found', 404)
      );

      await expect(
        service.compile({ scenarioRef: 'fraud/unknown@1.0.0', inputs: {} })
      ).rejects.toThrow(AppException);
    });
  });

  describe('compile - display', () => {
    it('should include display metadata', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        inputs: { amount: 100, isVip: true }
      });

      expect(result.display.title).toBe('Test Scenario');
      expect(result.display.scenarioRef).toBe('fraud/test@1.0.0');
      expect(result.display.expectedDecisionKinds).toEqual(['approve', 'decline']);
    });

    it('should include templateId in display when specified', async () => {
      mockIndex.getScenarioVersion.mockResolvedValue(mockScenario);
      mockIndex.getTemplate.mockResolvedValue(mockTemplate);

      const result = await service.compile({
        scenarioRef: 'fraud/test@1.0.0',
        templateId: 'strict',
        inputs: { amount: 100, isVip: true }
      });

      expect(result.display.templateId).toBe('strict');
    });
  });
});
