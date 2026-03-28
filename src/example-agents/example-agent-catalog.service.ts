import { Injectable, HttpStatus } from '@nestjs/common';
import { ExampleAgentDefinition, ExampleAgentSummary } from '../contracts/example-agents';
import { ParticipantTemplate } from '../contracts/registry';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

const FRAUD_SCENARIO = 'fraud/high-value-new-device@1.0.0';

const EXAMPLE_AGENT_DEFINITIONS: ExampleAgentDefinition[] = [
  {
    agentRef: 'fraud-agent',
    name: 'Fraud Agent',
    role: 'fraud',
    description: 'Evaluates device, chargeback, and identity-risk signals for the showcase flow.',
    framework: 'langgraph',
    supportedScenarioRefs: [FRAUD_SCENARIO],
    bootstrap: {
      strategy: 'external',
      entrypoint: 'agents/python/langgraph_fraud_agent.py',
      transportIdentity: 'agent://fraud-agent',
      mode: 'attached',
      launcher: 'python',
      notes: [
        'Backed by an active Python worker process that participates in the runtime session.',
        'Swap the worker implementation for a real LangGraph graph when you are ready to host framework-native agents.'
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
    supportedScenarioRefs: [FRAUD_SCENARIO],
    bootstrap: {
      strategy: 'external',
      entrypoint: 'agents/python/langchain_growth_agent.py',
      transportIdentity: 'agent://growth-agent',
      mode: 'attached',
      launcher: 'python',
      notes: [
        'Runs as an active Python host process with a LangChain-oriented manifest and control-plane loop.',
        'The transport contract stays stable even if you later replace the shim with a real chain or tool-calling agent.'
      ]
    },
    tags: ['growth', 'langchain', 'revenue']
  },
  {
    agentRef: 'compliance-agent',
    name: 'Compliance Agent',
    role: 'compliance',
    description: 'Applies onboarding, policy, and KYC/AML checks before the coordinator finalizes the decision.',
    framework: 'crewai',
    supportedScenarioRefs: [FRAUD_SCENARIO],
    bootstrap: {
      strategy: 'external',
      entrypoint: 'agents/python/crewai_compliance_agent.py',
      transportIdentity: 'agent://compliance-agent',
      mode: 'attached',
      launcher: 'python',
      notes: [
        'Demonstrates a CrewAI-style specialist that can raise objections or send evaluations into the same MACP session.',
        'The OSS worker keeps dependencies light while preserving the extension point for a real crew.'
      ]
    },
    tags: ['compliance', 'crewai', 'policy']
  },
  {
    agentRef: 'risk-agent',
    name: 'Risk Agent',
    role: 'risk',
    description: 'Coordinates the final recommendation and turns specialist input into a terminal commitment.',
    framework: 'custom',
    supportedScenarioRefs: [FRAUD_SCENARIO],
    bootstrap: {
      strategy: 'external',
      entrypoint: 'src/example-agents/runtime/risk-decider.worker.ts',
      transportIdentity: 'agent://risk-agent',
      mode: 'attached',
      launcher: 'node',
      notes: [
        'Acts as the decision owner for the showcase session and actively joins the runtime via the control plane.',
        'Because it is process-backed, you can replace it with another coordinator implementation without changing the scenario contract.'
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
