import { KickoffTemplate, ParticipantTemplate } from './registry';

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
  launchSummary: {
    modeName: string;
    modeVersion: string;
    configurationVersion: string;
    ttlMs: number;
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
  };
  session: {
    modeName: string;
    modeVersion: string;
    configurationVersion: string;
    ttlMs: number;
    participants: ParticipantTemplate[];
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  kickoff?: KickoffTemplate[];
}

export interface CompileLaunchResult {
  executionRequest: ExecutionRequest;
  display: {
    title: string;
    scenarioRef: string;
    templateId?: string;
    expectedDecisionKinds?: string[];
  };
}
