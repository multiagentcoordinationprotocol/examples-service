import { Test, TestingModule } from '@nestjs/testing';
import { AgentsController } from './agents.controller';
import { AgentProfileService } from '../catalog/agent-profile.service';

describe('AgentsController', () => {
  let controller: AgentsController;
  let mockService: Partial<AgentProfileService>;

  const mockProfiles = [
    {
      agentRef: 'fraud-agent',
      name: 'Fraud Agent',
      role: 'fraud',
      framework: 'langgraph',
      description: 'Fraud detection',
      transportIdentity: 'agent://fraud-agent',
      entrypoint: 'agents/langgraph_worker/main.py',
      bootstrapStrategy: 'external',
      bootstrapMode: 'attached',
      tags: ['fraud'],
      scenarios: ['fraud/high-value-new-device@1.0.0'],
      metrics: { runs: 0, signals: 0, averageLatencyMs: 0, averageConfidence: 0 }
    }
  ];

  beforeEach(async () => {
    mockService = {
      listProfiles: jest.fn().mockResolvedValue(mockProfiles),
      getProfile: jest.fn().mockResolvedValue(mockProfiles[0])
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: AgentProfileService, useValue: mockService }]
    }).compile();

    controller = module.get<AgentsController>(AgentsController);
  });

  it('listAgents returns profiles from service', async () => {
    const result = await controller.listAgents();
    expect(result).toEqual(mockProfiles);
    expect(mockService.listProfiles).toHaveBeenCalled();
  });

  it('getAgent returns single profile', async () => {
    const result = await controller.getAgent('fraud-agent');
    expect(result.agentRef).toBe('fraud-agent');
    expect(mockService.getProfile).toHaveBeenCalledWith('fraud-agent');
  });
});
