import { ExamplesController } from './examples.controller';
import { ExampleRunService } from '../launch/example-run.service';

describe('ExamplesController', () => {
  let controller: ExamplesController;
  let mockRunService: jest.Mocked<ExampleRunService>;

  beforeEach(() => {
    mockRunService = {
      run: jest.fn()
    } as unknown as jest.Mocked<ExampleRunService>;
    controller = new ExamplesController(mockRunService);
  });

  describe('run', () => {
    it('should delegate to ExampleRunService', async () => {
      const body = {
        scenarioRef: 'fraud/test@1.0.0',
        inputs: { amount: 100 },
        submitToControlPlane: false
      };
      const mockResult = {
        compiled: { executionRequest: {}, display: { title: 'Test', scenarioRef: 'fraud/test@1.0.0' }, participantBindings: [] },
        hostedAgents: [],
        controlPlane: { baseUrl: 'http://localhost:3001', validated: false, submitted: false }
      };
      mockRunService.run.mockResolvedValue(mockResult as never);

      const result = await controller.run(body);
      expect(result).toBe(mockResult);
      expect(mockRunService.run).toHaveBeenCalledWith(body);
    });

    it('should propagate errors from service', async () => {
      mockRunService.run.mockRejectedValue(new Error('compilation failed'));
      await expect(controller.run({ scenarioRef: 'bad', inputs: {} })).rejects.toThrow('compilation failed');
    });
  });
});
