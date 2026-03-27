import { HostedExampleAgent, ParticipantAgentBinding, ExampleAgentSummary } from './example-agents';
import { KickoffKind, PayloadEncoding, RuntimeSelectionTemplate } from './registry';

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

export interface PayloadEnvelope {
  encoding: PayloadEncoding;
  mediaType?: string;
  json?: Record<string, unknown>;
  text?: string;
  base64?: string;
  proto?: {
    typeName: string;
    value: Record<string, unknown>;
  };
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
    ttlMs: number;
    initiatorParticipantId?: string;
    participants: Array<{
      id: string;
      role?: string;
      transportIdentity?: string;
      metadata?: Record<string, unknown>;
    }>;
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

export interface CompileLaunchResult {
  executionRequest: ExecutionRequest;
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
  submitToControlPlane?: boolean;
}

export interface RunExampleResult {
  compiled: CompileLaunchResult;
  hostedAgents: HostedExampleAgent[];
  controlPlane?: {
    baseUrl: string;
    validated: boolean;
    submitted: boolean;
    runId?: string;
    status?: string;
    traceId?: string;
  };
}
