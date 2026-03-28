import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';
import { CompileLaunchResult } from '../contracts/launch';
import { ExampleAgentRunContext } from '../contracts/example-agents';
import { HostingService } from './hosting.service';
import { InMemoryExampleAgentHostProvider } from './in-memory-example-agent-host.provider';

describe('HostingService', () => {
  let service: HostingService;

  beforeEach(() => {
    service = new HostingService(new ExampleAgentCatalogService(), new InMemoryExampleAgentHostProvider());
  });

  function buildCompiled(): CompileLaunchResult {
    return {
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
            { id: 'compliance-agent', role: 'compliance' },
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
        { participantId: 'compliance-agent', role: 'compliance', agentRef: 'compliance-agent' },
        { participantId: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }
      ]
    };
  }

  it('resolves example agents and injects transport identities into the execution request', async () => {
    const compiled = buildCompiled();

    const hosted = await service.resolve(compiled);

    expect(hosted).toHaveLength(4);
    expect(hosted.every((agent) => agent.status === 'resolved')).toBe(true);
    expect(compiled.executionRequest.session.participants[0].transportIdentity).toBe('agent://fraud-agent');
    expect(compiled.executionRequest.session.metadata?.hostedParticipants).toHaveLength(4);
    expect(compiled.executionRequest.session.participants[2].metadata?.framework).toBe('crewai');
  });

  it('attaches example agents after a run is created', async () => {
    const compiled = buildCompiled();
    const context: ExampleAgentRunContext = {
      runId: 'run-1',
      traceId: 'trace-1',
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      ttlMs: 300000,
      participants: compiled.executionRequest.session.participants.map((participant) => participant.id),
      initiatorParticipantId: 'risk-agent'
    };

    const hosted = await service.attach(compiled, context);

    expect(hosted).toHaveLength(4);
    expect(hosted.every((agent) => agent.status === 'bootstrapped')).toBe(true);
    expect(compiled.executionRequest.session.participants[3].metadata?.attachedRunId).toBe('run-1');
  });
});
