import { Injectable } from '@nestjs/common';
import {
  ExampleAgentDefinition,
  ExampleAgentRunContext,
  HostedExampleAgent,
  ParticipantAgentBinding
} from '../contracts/example-agents';
import { ExampleAgentHostProvider } from './example-agent-host.provider';

@Injectable()
export class InMemoryExampleAgentHostProvider implements ExampleAgentHostProvider {
  async resolve(definition: ExampleAgentDefinition, binding: ParticipantAgentBinding): Promise<HostedExampleAgent> {
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
      status: 'resolved',
      participantMetadata: {
        role: binding.role,
        agentRef: definition.agentRef,
        framework: definition.framework,
        entrypoint: definition.bootstrap.entrypoint,
        launcher: definition.bootstrap.launcher,
        hostMode: 'preview'
      },
      notes: definition.bootstrap.notes,
      tags: definition.tags
    };
  }

  async attach(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding,
    context: ExampleAgentRunContext
  ): Promise<HostedExampleAgent> {
    return {
      ...(await this.resolve(definition, binding)),
      status: 'bootstrapped',
      participantMetadata: {
        role: binding.role,
        agentRef: definition.agentRef,
        framework: definition.framework,
        entrypoint: definition.bootstrap.entrypoint,
        launcher: definition.bootstrap.launcher,
        attachedRunId: context.runId,
        hostMode: 'in-memory'
      }
    };
  }
}
