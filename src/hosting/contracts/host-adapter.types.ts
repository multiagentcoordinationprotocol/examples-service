import { AgentFramework, AgentManifest, ManifestValidationResult } from './manifest.types';
import { BootstrapPayload } from './bootstrap.types';

export interface PrepareLaunchInput {
  manifest: AgentManifest;
  bootstrap: BootstrapPayload;
}

export interface PreparedLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  startupTimeoutMs: number;
}

export interface LaunchInput {
  manifest: AgentManifest;
  bootstrap: BootstrapPayload;
  bootstrapFilePath: string;
}

export interface LaunchedParticipant {
  participantId: string;
  agentId: string;
  framework: AgentFramework;
  pid?: number;
  startedAt: string;
}

export interface ParticipantHandle {
  participantId: string;
  runId: string;
  pid?: number;
  framework: AgentFramework;
}

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown' | 'starting' | 'stopped';

export interface AgentHostAdapter {
  readonly framework: AgentFramework;
  validateManifest(manifest: AgentManifest): ManifestValidationResult;
  prepareLaunch(input: PrepareLaunchInput): PreparedLaunch;
}

export const AGENT_HOST_ADAPTER_REGISTRY = 'AGENT_HOST_ADAPTER_REGISTRY';
