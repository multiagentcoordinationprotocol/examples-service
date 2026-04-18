import { AgentManifest } from '../hosting/contracts/manifest.types';

export type ExampleAgentFramework = 'langgraph' | 'langchain' | 'crewai' | 'custom' | 'mock';

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
    launcher?: 'node' | 'python';
    args?: string[];
    env?: Record<string, string>;
    notes?: string[];
  };
  manifest?: AgentManifest;
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

export interface ExampleAgentRunContext {
  runId: string;
  /**
   * Pre-allocated shared session id (UUID v4) that every agent in the run
   * receives via its bootstrap. Populated when examples-service owns session
   * id allocation (direct-agent-auth); may be empty during legacy launches.
   */
  sessionId?: string;
  traceId?: string;
  scenarioRef: string;
  modeName: string;
  modeVersion: string;
  configurationVersion: string;
  policyVersion?: string;
  policyHints?: {
    type?: string;
    description?: string;
    threshold?: number;
    vetoEnabled?: boolean;
    vetoRoles?: string[];
    vetoThreshold?: number;
    minimumConfidence?: number;
    designatedRoles?: string[];
  };
  ttlMs: number;
  sessionContext?: Record<string, unknown>;
  participants: string[];
  initiatorParticipantId?: string;
  /**
   * Bundled initiator payload. Only the agent whose `participantId` equals
   * `initiator.participantId` receives `initiator.sessionStart` / `initiator.kickoff`
   * in its bootstrap.
   */
  initiator?: {
    participantId: string;
    sessionStart: {
      intent: string;
      participants: string[];
      ttlMs: number;
      modeVersion: string;
      configurationVersion: string;
      policyVersion?: string;
      context?: Record<string, unknown>;
      contextId?: string;
      extensions?: Record<string, unknown>;
      roots?: Array<{ uri: string; name?: string }>;
    };
    kickoff?: {
      messageType: string;
      payloadType?: string;
      payload: Record<string, unknown>;
    };
  };
}
