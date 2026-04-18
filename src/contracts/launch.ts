import { HostedExampleAgent, ParticipantAgentBinding, ExampleAgentSummary } from './example-agents';
import { CommitmentDefinition, KickoffKind, PayloadEnvelopeTemplate, RuntimeSelectionTemplate } from './registry';
import { RunDescriptor } from './run-descriptor';

export type { CommitmentDefinition };
export type { RunDescriptor };
/** Alias retained for callers that imported `PayloadEnvelope`. Structurally identical to `PayloadEnvelopeTemplate`. */
export type PayloadEnvelope = PayloadEnvelopeTemplate;

export interface LaunchSchemaResponse {
  scenarioRef: string;
  templateId?: string;
  formSchema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  participants: Array<{
    id: string;
    role: string;
    agentRef: string;
  }>;
  agents: ExampleAgentSummary[];
  runtime: RuntimeSelectionTemplate;
  launchSummary: {
    modeName: string;
    modeVersion: string;
    configurationVersion: string;
    policyVersion?: string;
    policyHints?: {
      type?: string;
      description?: string;
      threshold?: number;
      vetoEnabled?: boolean;
      criticalSeverityVetoes?: boolean;
      vetoRoles?: string[];
      vetoThreshold?: number;
      minimumConfidence?: number;
      designatedRoles?: string[];
    };
    ttlMs: number;
    initiatorParticipantId?: string;
  };
  expectedDecisionKinds?: string[];
}

export interface CompileLaunchRequest {
  scenarioRef: string;
  templateId?: string;
  inputs: Record<string, unknown>;
  mode?: 'live' | 'sandbox';
}

export interface ExecutionRequest {
  mode: 'live' | 'sandbox';
  runtime: {
    kind: string;
    version?: string;
  };
  session: {
    modeName: string;
    modeVersion: string;
    configurationVersion: string;
    policyVersion?: string;
    policyHints?: {
      type?: string;
      description?: string;
      threshold?: number;
      vetoEnabled?: boolean;
      criticalSeverityVetoes?: boolean;
      vetoRoles?: string[];
      vetoThreshold?: number;
      minimumConfidence?: number;
      designatedRoles?: string[];
    };
    ttlMs: number;
    initiatorParticipantId?: string;
    participants: Array<{
      id: string;
      role?: string;
      transportIdentity?: string;
      metadata?: Record<string, unknown>;
    }>;
    commitments?: CommitmentDefinition[];
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  kickoff?: Array<{
    from: string;
    to: string[];
    kind: KickoffKind;
    messageType: string;
    payload?: Record<string, unknown>;
    payloadEnvelope?: PayloadEnvelope;
    metadata?: Record<string, unknown>;
  }>;
  execution?: {
    idempotencyKey?: string;
    tags?: string[];
    requester?: {
      actorId?: string;
      actorType?: 'user' | 'service' | 'system';
    };
  };
}

/**
 * Initiator-only compile output: the payload the initiator agent needs to
 * emit the first SessionStart envelope and the first mode-specific envelope
 * (e.g. Proposal). Non-initiator agents do not receive this.
 */
export interface InitiatorPayload {
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
    /** Proto typeName the agent should encode the payload with. */
    payloadType?: string;
    payload: Record<string, unknown>;
  };
}

export interface CompileLaunchResult {
  /**
   * Legacy control-plane contract. Retained verbatim until CP-1 lands; after
   * that, this collapses into a thin adapter over `runDescriptor` + the
   * initiator payload.
   */
  executionRequest: ExecutionRequest;
  /** Forward-compatible generic descriptor for `POST /runs` (CP-1). */
  runDescriptor: RunDescriptor;
  /** Present iff the scenario has a kickoff and an identifiable initiator. */
  initiator?: InitiatorPayload;
  /** Shared session id pre-allocated at compile time (UUID v4). */
  sessionId: string;
  display: {
    title: string;
    scenarioRef: string;
    templateId?: string;
    expectedDecisionKinds?: string[];
  };
  participantBindings: ParticipantAgentBinding[];
}

export interface RunExampleRequest extends CompileLaunchRequest {
  bootstrapAgents?: boolean;
  tags?: string[];
  requester?: { actorId?: string; actorType?: 'user' | 'service' | 'system' };
  runLabel?: string;
}

export interface RunExampleResult {
  compiled: CompileLaunchResult;
  hostedAgents: HostedExampleAgent[];
  sessionId?: string;
}
