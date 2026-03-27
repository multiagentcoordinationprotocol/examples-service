import { Injectable, HttpStatus } from '@nestjs/common';
import { ExampleAgentDefinition, ExampleAgentSummary } from '../contracts/example-agents';
import { ParticipantTemplate } from '../contracts/registry';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

const EXAMPLE_AGENT_DEFINITIONS: ExampleAgentDefinition[] = [
  {
    agentRef: 'fraud-agent',
    name: 'Fraud Agent',
    role: 'fraud',
    description: 'Evaluates device, chargeback, and identity-risk signals for the showcase flow.',
    framework: 'langgraph',
    bootstrap: {
      strategy: 'manifest-only',
      entrypoint: 'examples/fraud/langgraph_fraud_agent.py:create_graph',
      transportIdentity: 'agent://fraud-agent',
      mode: 'deferred',
      notes: [
        'Intended to be backed by a LangGraph specialist graph.',
        'OSS implementation exposes the manifest and transport identity; plug in a concrete host when ready.'
      ]
    },
    tags: ['fraud', 'langgraph', 'risk']
  },
  {
    agentRef: 'growth-agent',
    name: 'Growth Agent',
    role: 'growth',
    description: 'Assesses customer value, revenue impact, and experience trade-offs.',
    framework: 'langchain',
    bootstrap: {
      strategy: 'manifest-only',
      entrypoint: 'examples/growth/langchain_growth_agent.py:create_agent',
      transportIdentity: 'agent://growth-agent',
      mode: 'deferred',
      notes: [
        'Intended to be backed by a LangChain agent or chain.',
        'Example service resolves the binding and transport identity for the control plane run.'
      ]
    },
    tags: ['growth', 'langchain', 'revenue']
  },
  {
    agentRef: 'risk-agent',
    name: 'Risk Agent',
    role: 'risk',
    description: 'Coordinates the final recommendation and turns specialist input into a decision.',
    framework: 'custom',
    bootstrap: {
      strategy: 'manifest-only',
      entrypoint: 'examples/risk/risk_decider.ts:createCoordinator',
      transportIdentity: 'agent://risk-agent',
      mode: 'deferred',
      notes: [
        'Acts as the decision owner for the showcase session.',
        'You can later back this with a custom TypeScript host, LangGraph workflow, or another framework.'
      ]
    },
    tags: ['risk', 'coordinator', 'decision']
  }
];

@Injectable()
export class ExampleAgentCatalogService {
  private readonly definitions = new Map<string, ExampleAgentDefinition>(
    EXAMPLE_AGENT_DEFINITIONS.map((definition) => [definition.agentRef, definition])
  );

  list(): ExampleAgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  get(agentRef: string): ExampleAgentDefinition {
    const definition = this.definitions.get(agentRef);
    if (!definition) {
      throw new AppException(
        ErrorCode.AGENT_NOT_FOUND,
        `example agent not found: ${agentRef}`,
        HttpStatus.NOT_FOUND
      );
    }
    return definition;
  }

  summarize(agentRef: string): ExampleAgentSummary {
    const definition = this.get(agentRef);
    return {
      agentRef: definition.agentRef,
      name: definition.name,
      role: definition.role,
      framework: definition.framework,
      description: definition.description,
      transportIdentity: definition.bootstrap.transportIdentity,
      entrypoint: definition.bootstrap.entrypoint,
      bootstrapStrategy: definition.bootstrap.strategy,
      bootstrapMode: definition.bootstrap.mode,
      tags: definition.tags
    };
  }

  summarizeParticipants(participants: ParticipantTemplate[]): ExampleAgentSummary[] {
    return participants.map((participant) => {
      const summary = this.summarize(participant.agentRef);
      return {
        ...summary,
        role: participant.role || summary.role
      };
    });
  }
}
