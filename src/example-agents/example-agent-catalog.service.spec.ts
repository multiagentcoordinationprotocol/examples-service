import { ExampleAgentCatalogService } from './example-agent-catalog.service';
import { AppException } from '../errors/app-exception';

describe('ExampleAgentCatalogService', () => {
  let service: ExampleAgentCatalogService;

  beforeEach(() => {
    service = new ExampleAgentCatalogService();
  });

  it('returns built-in example agents', () => {
    const agents = service.list();
    expect(agents.map((agent) => agent.agentRef)).toEqual(
      expect.arrayContaining(['fraud-agent', 'growth-agent', 'risk-agent'])
    );
  });

  it('summarizes participants for the launch schema', () => {
    const summary = service.summarizeParticipants([
      { id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
      { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' }
    ]);

    expect(summary).toHaveLength(2);
    expect(summary[0].framework).toBe('langgraph');
    expect(summary[1].framework).toBe('langchain');
  });

  it('throws when an example agent is missing', () => {
    expect(() => service.get('missing-agent')).toThrow(AppException);
  });
});
