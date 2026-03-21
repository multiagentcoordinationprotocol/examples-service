import { CatalogController } from './catalog.controller';
import { CatalogService } from '../catalog/catalog.service';

describe('CatalogController', () => {
  let controller: CatalogController;
  let mockService: jest.Mocked<CatalogService>;

  beforeEach(() => {
    mockService = {
      listPacks: jest.fn(),
      listScenarios: jest.fn()
    } as unknown as jest.Mocked<CatalogService>;
    controller = new CatalogController(mockService);
  });

  describe('listPacks', () => {
    it('should delegate to catalog service', async () => {
      const packs = [{ slug: 'fraud', name: 'Fraud' }];
      mockService.listPacks.mockResolvedValue(packs);
      const result = await controller.listPacks();
      expect(result).toBe(packs);
      expect(mockService.listPacks).toHaveBeenCalledTimes(1);
    });
  });

  describe('listScenarios', () => {
    it('should delegate with packSlug param', async () => {
      const scenarios = [{ scenario: 'test', name: 'Test', versions: ['1.0.0'], templates: ['default'] }];
      mockService.listScenarios.mockResolvedValue(scenarios);
      const result = await controller.listScenarios('fraud');
      expect(result).toBe(scenarios);
      expect(mockService.listScenarios).toHaveBeenCalledWith('fraud');
    });

    it('should propagate errors from service', async () => {
      mockService.listScenarios.mockRejectedValue(new Error('not found'));
      await expect(controller.listScenarios('bad')).rejects.toThrow('not found');
    });
  });
});
