import { HostedExampleAgent, ExampleAgentDefinition, ParticipantAgentBinding } from '../contracts/example-agents';

export const EXAMPLE_AGENT_HOST_PROVIDER = 'EXAMPLE_AGENT_HOST_PROVIDER';

export interface ExampleAgentHostProvider {
  bootstrap(definition: ExampleAgentDefinition, binding: ParticipantAgentBinding): Promise<HostedExampleAgent>;
}
