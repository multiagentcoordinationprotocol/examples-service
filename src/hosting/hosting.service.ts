import { Inject, Injectable } from '@nestjs/common';
import { ExampleAgentDefinition, ExampleAgentRunContext, HostedExampleAgent } from '../contracts/example-agents';
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

  async resolve(compiled: CompileLaunchResult): Promise<HostedExampleAgent[]> {
    const hostedAgents = await this.materializeHostedAgents(compiled, async (definition, binding) =>
      this.hostProvider.resolve(definition, binding)
    );

    this.applyHostedAgents(compiled, hostedAgents);
    return hostedAgents;
  }

  async attach(compiled: CompileLaunchResult, context: ExampleAgentRunContext): Promise<HostedExampleAgent[]> {
    const hostedAgents = await this.materializeHostedAgents(compiled, async (definition, binding) => {
      if (!this.hostProvider.attach) {
        return this.hostProvider.resolve(definition, binding);
      }
      return this.hostProvider.attach(definition, binding, context);
    });

    this.applyHostedAgents(compiled, hostedAgents);
    return hostedAgents;
  }

  private async materializeHostedAgents(
    compiled: CompileLaunchResult,
    resolver: (definition: ExampleAgentDefinition, binding: CompileLaunchResult['participantBindings'][number]) => Promise<HostedExampleAgent>
  ): Promise<HostedExampleAgent[]> {
    const hostedAgents: HostedExampleAgent[] = [];

    for (const binding of compiled.participantBindings) {
      const definition = this.exampleAgents.get(binding.agentRef);
      hostedAgents.push(await resolver(definition, binding));
    }

    return hostedAgents;
  }

  private applyHostedAgents(compiled: CompileLaunchResult, hostedAgents: HostedExampleAgent[]): void {
    for (const hosted of hostedAgents) {
      const participant = compiled.executionRequest.session.participants.find(
        (candidate) => candidate.id === hosted.participantId
      );

      if (!participant) {
        continue;
      }

      participant.transportIdentity = hosted.transportIdentity;
      participant.metadata = {
        ...(participant.metadata ?? {}),
        ...(hosted.participantMetadata ?? {}),
        agentRef: hosted.agentRef,
        framework: hosted.framework,
        entrypoint: hosted.entrypoint,
        bootstrapStrategy: hosted.bootstrapStrategy,
        bootstrapMode: hosted.bootstrapMode,
        hostedStatus: hosted.status,
        bootstrappedBy: 'example-service'
      };
    }

    compiled.executionRequest.session.metadata = {
      ...(compiled.executionRequest.session.metadata ?? {}),
      hostedParticipants: hostedAgents.map((agent) => ({
        participantId: agent.participantId,
        agentRef: agent.agentRef,
        transportIdentity: agent.transportIdentity,
        framework: agent.framework,
        entrypoint: agent.entrypoint,
        bootstrapStrategy: agent.bootstrapStrategy,
        bootstrapMode: agent.bootstrapMode,
        status: agent.status,
        participantMetadata: agent.participantMetadata ?? {}
      }))
    };
  }
}
