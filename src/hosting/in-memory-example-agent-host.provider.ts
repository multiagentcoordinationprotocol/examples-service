import { Injectable } from '@nestjs/common';
import {
  ExampleAgentDefinition,
  HostedExampleAgent,
  ParticipantAgentBinding
} from '../contracts/example-agents';
import { ExampleAgentHostProvider } from './example-agent-host.provider';

@Injectable()
export class InMemoryExampleAgentHostProvider implements ExampleAgentHostProvider {
  async bootstrap(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding
  ): Promise<HostedExampleAgent> {
    return {
      participantId: binding.participantId,
      agentRef: definition.agentRef,
      name: definition.name,
      role: binding.role,
      framework: definition.framework,
      description: definition.description,
      transportIdentity: definition.bootstrap.transportIdentity,
      entrypoint: definition.bootstrap.entrypoint,
      bootstrapStrategy: definition.bootstrap.strategy,
      bootstrapMode: definition.bootstrap.mode,
      status: 'bootstrapped',
      participantMetadata: {
        role: binding.role,
        agentRef: definition.agentRef,
        framework: definition.framework,
        entrypoint: definition.bootstrap.entrypoint
      },
      notes: definition.bootstrap.notes,
      tags: definition.tags
    };
  }
}
