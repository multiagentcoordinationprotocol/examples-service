export type ExampleAgentFramework = 'langgraph' | 'langchain' | 'custom' | 'mock';

export type ExampleAgentBootstrapStrategy = 'in-process' | 'external' | 'container' | 'manifest-only';

export interface ExampleAgentDefinition {
  agentRef: string;
  name: string;
  role: string;
  description?: string;
  framework: ExampleAgentFramework;
  supportedScenarioRefs?: string[];
  bootstrap: {
    strategy: ExampleAgentBootstrapStrategy;
    entrypoint: string;
    transportIdentity: string;
    mode: 'mock' | 'deferred' | 'attached';
    env?: Record<string, string>;
    notes?: string[];
  };
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface ExampleAgentSummary {
  agentRef: string;
  name: string;
  role: string;
  framework: ExampleAgentFramework;
  description?: string;
  transportIdentity: string;
  entrypoint: string;
  bootstrapStrategy: ExampleAgentBootstrapStrategy;
  bootstrapMode: 'mock' | 'deferred' | 'attached';
  tags?: string[];
}

export interface HostedExampleAgent extends ExampleAgentSummary {
  participantId: string;
  status: 'resolved' | 'bootstrapped';
  participantMetadata?: Record<string, unknown>;
  notes?: string[];
}

export interface ParticipantAgentBinding {
  participantId: string;
  role: string;
  agentRef: string;
}
