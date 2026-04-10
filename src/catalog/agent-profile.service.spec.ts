import { AgentProfileService } from './agent-profile.service';
import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';
import { RegistryIndexService } from '../registry/registry-index.service';
import { ControlPlaneClient } from '../control-plane/control-plane.client';

describe('AgentProfileService', () => {
  let service: AgentProfileService;
  let mockAgentCatalog: Partial<ExampleAgentCatalogService>;
  let mockRegistryIndex: Partial<RegistryIndexService>;

  const mockDefinitions = [
    {
      agentRef: 'fraud-agent',
      name: 'Fraud Agent',
      role: 'fraud',
      framework: 'langgraph',
      description: 'Fraud detection agent',
      bootstrap: {
        strategy: 'external',
        entrypoint: 'agents/langgraph_worker/main.py',
        transportIdentity: 'agent://fraud-agent',
        mode: 'attached'
      },
      tags: ['fraud', 'langgraph']
    },
    {
      agentRef: 'growth-agent',
      name: 'Growth Agent',
      role: 'growth',
      framework: 'langchain',
      bootstrap: {
        strategy: 'external',
        entrypoint: 'agents/langchain_worker/main.py',
        transportIdentity: 'agent://growth-agent',
        mode: 'attached'
      },
      tags: ['growth']
    }
  ];

  const mockSnapshot = {
    packs: new Map([
      [
        'fraud',
        {
          pack: { metadata: { slug: 'fraud' } },
          scenarios: new Map([
            [
              'high-value-new-device',
              {
                versions: new Map([
                  [
                    '1.0.0',
                    {
                      scenario: {
                        spec: {
                          launch: {
                            participants: [
                              { id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
                              { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' }
                            ]
                          }
                        }
                      }
                    }
                  ]
                ])
              }
            ]
          ])
        }
      ],
      [
        'lending',
        {
          pack: { metadata: { slug: 'lending' } },
          scenarios: new Map([
            [
              'loan-underwriting',
              {
                versions: new Map([
                  [
                    '1.0.0',
                    {
                      scenario: {
                        spec: {
                          launch: {
                            participants: [{ id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' }]
                          }
                        }
                      }
                    }
                  ]
                ])
              }
            ]
          ])
        }
      ]
    ])
  };

  beforeEach(() => {
    mockAgentCatalog = {
      list: jest.fn().mockReturnValue(mockDefinitions),
      get: jest.fn().mockImplementation((ref: string) => {
        const found = mockDefinitions.find((d) => d.agentRef === ref);
        if (!found) throw new Error(`agent not found: ${ref}`);
        return found;
      })
    };

    mockRegistryIndex = {
      getSnapshot: jest.fn().mockResolvedValue(mockSnapshot)
    };

    const mockControlPlaneClient = {
      getAgentMetrics: jest.fn().mockResolvedValue([])
    };

    service = new AgentProfileService(
      mockAgentCatalog as ExampleAgentCatalogService,
      mockRegistryIndex as RegistryIndexService,
      mockControlPlaneClient as unknown as ControlPlaneClient
    );
  });

  describe('listProfiles', () => {
    it('returns profiles for all agents', async () => {
      const profiles = await service.listProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles[0].agentRef).toBe('fraud-agent');
      expect(profiles[1].agentRef).toBe('growth-agent');
    });

    it('computes scenario coverage from registry', async () => {
      const profiles = await service.listProfiles();
      const fraudAgent = profiles.find((p) => p.agentRef === 'fraud-agent')!;
      expect(fraudAgent.scenarios).toContain('fraud/high-value-new-device@1.0.0');
      expect(fraudAgent.scenarios).toContain('lending/loan-underwriting@1.0.0');
      expect(fraudAgent.scenarios).toHaveLength(2);
    });

    it('growth-agent only in fraud scenario', async () => {
      const profiles = await service.listProfiles();
      const growthAgent = profiles.find((p) => p.agentRef === 'growth-agent')!;
      expect(growthAgent.scenarios).toEqual(['fraud/high-value-new-device@1.0.0']);
    });

    it('includes agent metadata', async () => {
      const profiles = await service.listProfiles();
      const fraudAgent = profiles.find((p) => p.agentRef === 'fraud-agent')!;
      expect(fraudAgent.name).toBe('Fraud Agent');
      expect(fraudAgent.framework).toBe('langgraph');
      expect(fraudAgent.description).toBe('Fraud detection agent');
      expect(fraudAgent.transportIdentity).toBe('agent://fraud-agent');
      expect(fraudAgent.entrypoint).toBe('agents/langgraph_worker/main.py');
      expect(fraudAgent.bootstrapStrategy).toBe('external');
      expect(fraudAgent.bootstrapMode).toBe('attached');
      expect(fraudAgent.tags).toEqual(['fraud', 'langgraph']);
    });

    it('returns zero metrics', async () => {
      const profiles = await service.listProfiles();
      expect(profiles[0].metrics).toEqual({
        runs: 0,
        signals: 0,
        averageLatencyMs: 0,
        averageConfidence: 0
      });
    });
  });

  describe('getProfile', () => {
    it('returns a single agent profile', async () => {
      const profile = await service.getProfile('fraud-agent');
      expect(profile.agentRef).toBe('fraud-agent');
      expect(profile.scenarios).toHaveLength(2);
    });

    it('throws for unknown agent', async () => {
      await expect(service.getProfile('nonexistent')).rejects.toThrow();
    });
  });
});
