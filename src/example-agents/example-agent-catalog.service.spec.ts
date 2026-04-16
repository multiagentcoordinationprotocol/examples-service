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
      expect.arrayContaining(['fraud-agent', 'growth-agent', 'compliance-agent', 'risk-agent'])
    );
    expect(agents).toHaveLength(4);
  });

  it('every cataloged agent ships with a manifest (enables adapter-based launch, avoids legacy fallback)', () => {
    const agents = service.list();
    for (const agent of agents) {
      expect(agent.manifest).toBeDefined();
      // Spot-check required manifest fields so the test fails loudly when someone
      // wires a manifest-less agent (which would fall back to ProcessExampleAgentHostProvider.launchLegacy).
      expect(agent.manifest?.framework).toBe(agent.framework);
      expect(agent.manifest?.entrypoint?.value).toBe(agent.bootstrap.entrypoint);
    }
  });

  it('summarizes participants for the launch schema', () => {
    const summary = service.summarizeParticipants([
      { id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
      { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' },
      { id: 'compliance-agent', role: 'compliance', agentRef: 'compliance-agent' }
    ]);

    expect(summary).toHaveLength(3);
    expect(summary[0].framework).toBe('langgraph');
    expect(summary[1].framework).toBe('langchain');
    expect(summary[2].framework).toBe('crewai');
  });

  it('throws when an example agent is missing', () => {
    expect(() => service.get('missing-agent')).toThrow(AppException);
  });
});
