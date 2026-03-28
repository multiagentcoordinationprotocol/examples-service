import {
  ExampleAgentDefinition,
  ExampleAgentRunContext,
  HostedExampleAgent,
  ParticipantAgentBinding
} from '../contracts/example-agents';

export const EXAMPLE_AGENT_HOST_PROVIDER = 'EXAMPLE_AGENT_HOST_PROVIDER';

export interface ExampleAgentHostProvider {
  resolve(definition: ExampleAgentDefinition, binding: ParticipantAgentBinding): Promise<HostedExampleAgent>;
  attach?(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding,
    context: ExampleAgentRunContext
  ): Promise<HostedExampleAgent>;
}
