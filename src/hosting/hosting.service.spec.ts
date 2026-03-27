import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';
import { CompileLaunchResult } from '../contracts/launch';
import { HostingService } from './hosting.service';
import { InMemoryExampleAgentHostProvider } from './in-memory-example-agent-host.provider';

describe('HostingService', () => {
  let service: HostingService;

  beforeEach(() => {
    service = new HostingService(new ExampleAgentCatalogService(), new InMemoryExampleAgentHostProvider());
  });

  it('bootstraps example agents and injects transport identities into the execution request', async () => {
    const compiled: CompileLaunchResult = {
      executionRequest: {
        mode: 'sandbox',
        runtime: { kind: 'rust', version: 'v1' },
        session: {
          modeName: 'macp.mode.decision.v1',
          modeVersion: '1.0.0',
          configurationVersion: 'config.default',
          ttlMs: 300000,
          participants: [
            { id: 'fraud-agent', role: 'fraud' },
            { id: 'growth-agent', role: 'growth' },
            { id: 'risk-agent', role: 'risk' }
          ]
        }
      },
      display: {
        title: 'Fraud',
        scenarioRef: 'fraud/high-value-new-device@1.0.0'
      },
      participantBindings: [
        { participantId: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
        { participantId: 'growth-agent', role: 'growth', agentRef: 'growth-agent' },
        { participantId: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }
      ]
    };

    const hosted = await service.bootstrap(compiled);

    expect(hosted).toHaveLength(3);
    expect(compiled.executionRequest.session.participants[0].transportIdentity).toBe('agent://fraud-agent');
    expect(compiled.executionRequest.session.metadata?.hostedParticipants).toHaveLength(3);
  });
});
