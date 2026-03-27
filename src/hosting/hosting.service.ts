import { Inject, Injectable } from '@nestjs/common';
import { HostedExampleAgent } from '../contracts/example-agents';
import { CompileLaunchResult } from '../contracts/launch';
import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';
import { EXAMPLE_AGENT_HOST_PROVIDER, ExampleAgentHostProvider } from './example-agent-host.provider';

@Injectable()
export class HostingService {
  constructor(
    private readonly exampleAgents: ExampleAgentCatalogService,
    @Inject(EXAMPLE_AGENT_HOST_PROVIDER)
    private readonly hostProvider: ExampleAgentHostProvider
  ) {}

  async bootstrap(compiled: CompileLaunchResult): Promise<HostedExampleAgent[]> {
    const hostedAgents: HostedExampleAgent[] = [];

    for (const binding of compiled.participantBindings) {
      const definition = this.exampleAgents.get(binding.agentRef);
      const hosted = await this.hostProvider.bootstrap(definition, binding);
      hostedAgents.push(hosted);

      const participant = compiled.executionRequest.session.participants.find(
        (candidate) => candidate.id === binding.participantId
      );

      if (participant) {
        participant.transportIdentity = hosted.transportIdentity;
        participant.metadata = {
          ...(participant.metadata ?? {}),
          agentRef: hosted.agentRef,
          framework: hosted.framework,
          entrypoint: hosted.entrypoint,
          bootstrappedBy: 'example-service'
        };
      }
    }

    compiled.executionRequest.session.metadata = {
      ...(compiled.executionRequest.session.metadata ?? {}),
      hostedParticipants: hostedAgents.map((agent) => ({
        participantId: agent.participantId,
        agentRef: agent.agentRef,
        transportIdentity: agent.transportIdentity,
        framework: agent.framework
      }))
    };

    return hostedAgents;
  }
}
