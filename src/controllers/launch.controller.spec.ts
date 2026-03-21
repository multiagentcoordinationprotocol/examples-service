import { LaunchController } from './launch.controller';
import { LaunchService } from '../launch/launch.service';
import { CompilerService } from '../launch/compiler.service';

describe('LaunchController', () => {
  let controller: LaunchController;
  let mockLaunchService: jest.Mocked<LaunchService>;
  let mockCompilerService: jest.Mocked<CompilerService>;

  beforeEach(() => {
    mockLaunchService = {
      getLaunchSchema: jest.fn()
    } as unknown as jest.Mocked<LaunchService>;
    mockCompilerService = {
      compile: jest.fn()
    } as unknown as jest.Mocked<CompilerService>;
    controller = new LaunchController(mockLaunchService, mockCompilerService);
  });

  describe('getLaunchSchema', () => {
    it('should delegate with correct params', async () => {
      const mockResult = { scenarioRef: 'fraud/test@1.0.0', formSchema: {}, defaults: {}, participants: [], launchSummary: { modeName: 'mode', modeVersion: '1.0.0', configurationVersion: '1.0.0', ttlMs: 300000 } };
      mockLaunchService.getLaunchSchema.mockResolvedValue(mockResult);

      const result = await controller.getLaunchSchema('fraud', 'test', '1.0.0', 'default');
      expect(result).toBe(mockResult);
      expect(mockLaunchService.getLaunchSchema).toHaveBeenCalledWith('fraud', 'test', '1.0.0', 'default');
    });

    it('should pass undefined template when not provided', async () => {
      mockLaunchService.getLaunchSchema.mockResolvedValue({} as never);
      await controller.getLaunchSchema('fraud', 'test', '1.0.0', undefined);
      expect(mockLaunchService.getLaunchSchema).toHaveBeenCalledWith('fraud', 'test', '1.0.0', undefined);
    });

    it('should propagate errors', async () => {
      mockLaunchService.getLaunchSchema.mockRejectedValue(new Error('not found'));
      await expect(controller.getLaunchSchema('fraud', 'test', '1.0.0')).rejects.toThrow();
    });
  });

  describe('compile', () => {
    it('should delegate body to compiler service', async () => {
      const body = { scenarioRef: 'fraud/test@1.0.0', inputs: { amount: 100 } };
      const mockResult = { executionRequest: {}, display: { title: 'Test', scenarioRef: 'fraud/test@1.0.0' } };
      mockCompilerService.compile.mockResolvedValue(mockResult as never);

      const result = await controller.compile(body);
      expect(result).toBe(mockResult);
      expect(mockCompilerService.compile).toHaveBeenCalledWith(body);
    });

    it('should propagate validation errors', async () => {
      mockCompilerService.compile.mockRejectedValue(new Error('validation error'));
      await expect(controller.compile({ scenarioRef: 'bad', inputs: {} })).rejects.toThrow();
    });
  });
});
