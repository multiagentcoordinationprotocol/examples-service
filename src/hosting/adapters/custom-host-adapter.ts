import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AgentHostAdapter,
  PrepareLaunchInput,
  PreparedLaunch
} from '../contracts/host-adapter.types';
import { AgentFramework, AgentManifest, ManifestValidationResult } from '../contracts/manifest.types';

const DEFAULT_STARTUP_TIMEOUT_MS = 15000;

export class CustomHostAdapter implements AgentHostAdapter {
  readonly framework: AgentFramework = 'custom';

  validateManifest(manifest: AgentManifest): ManifestValidationResult {
    const errors: string[] = [];

    if (manifest.framework !== 'custom') {
      errors.push(`expected framework "custom", got "${manifest.framework}"`);
    }

    if (!manifest.entrypoint?.value) {
      errors.push('entrypoint.value is required');
    }

    return { valid: errors.length === 0, errors };
  }

  prepareLaunch(input: PrepareLaunchInput): PreparedLaunch {
    const { manifest, bootstrap } = input;
    const cwd = manifest.host?.cwd ?? process.cwd();
    const entrypoint = this.resolveEntrypoint(manifest.entrypoint.value, manifest.entrypoint.type, cwd);

    const isNode = manifest.entrypoint.type === 'node_file';
    const command = isNode
      ? (manifest.host?.node ?? process.execPath)
      : (manifest.host?.python ?? 'python3');

    const args = isNode
      ? [entrypoint, ...(manifest.host?.args ?? [])]
      : manifest.entrypoint.type === 'python_module'
        ? ['-m', entrypoint, ...(manifest.host?.args ?? [])]
        : [entrypoint, ...(manifest.host?.args ?? [])];

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(manifest.host?.env ?? {}),
      MACP_BOOTSTRAP_FILE: '',
      MACP_CONTROL_PLANE_URL: bootstrap.runtime.baseUrl,
      MACP_LOG_LEVEL: 'info',
      MACP_FRAMEWORK: 'custom',
      MACP_PARTICIPANT_ID: bootstrap.participant.participantId,
      MACP_RUN_ID: bootstrap.run.runId,
      // Legacy env vars required by Node.js example agent workers
      CONTROL_PLANE_BASE_URL: bootstrap.runtime.baseUrl,
      CONTROL_PLANE_API_KEY: bootstrap.runtime.apiKey ?? '',
      CONTROL_PLANE_TIMEOUT_MS: String(bootstrap.runtime.timeoutMs ?? 10000),
      EXAMPLE_AGENT_RUN_ID: bootstrap.run.runId,
      EXAMPLE_AGENT_TRACE_ID: bootstrap.run.traceId ?? '',
      EXAMPLE_AGENT_SCENARIO_REF: bootstrap.execution.scenarioRef,
      EXAMPLE_AGENT_MODE_NAME: bootstrap.execution.modeName,
      EXAMPLE_AGENT_MODE_VERSION: bootstrap.execution.modeVersion ?? '1.0.0',
      EXAMPLE_AGENT_CONFIGURATION_VERSION: bootstrap.execution.configurationVersion ?? 'config.default',
      EXAMPLE_AGENT_POLICY_VERSION: bootstrap.execution.policyVersion ?? '',
      EXAMPLE_AGENT_POLICY_HINTS_JSON: JSON.stringify(bootstrap.execution.policyHints ?? {}),
      EXAMPLE_AGENT_SESSION_TTL_MS: String(bootstrap.execution.ttlMs ?? 300000),
      EXAMPLE_AGENT_INITIATOR_PARTICIPANT_ID: bootstrap.execution.initiatorParticipantId ?? '',
      EXAMPLE_AGENT_CONTEXT_JSON: JSON.stringify(bootstrap.session.context ?? {}),
      EXAMPLE_AGENT_PARTICIPANTS_JSON: JSON.stringify(bootstrap.session.participants ?? []),
      EXAMPLE_AGENT_REF: bootstrap.participant.agentId ?? manifest.id,
      EXAMPLE_AGENT_PARTICIPANT_ID: bootstrap.participant.participantId,
      EXAMPLE_AGENT_ROLE: bootstrap.participant.role ?? '',
      EXAMPLE_AGENT_FRAMEWORK: 'custom',
      EXAMPLE_AGENT_TRANSPORT_IDENTITY: `agent://${bootstrap.participant.agentId ?? manifest.id}`,
      EXAMPLE_AGENT_ENTRYPOINT: manifest.entrypoint.value
    };

    if (!isNode) {
      env.PYTHONUNBUFFERED = '1';
    }

    return {
      command,
      args,
      env,
      cwd,
      startupTimeoutMs: manifest.host?.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    };
  }

  /**
   * Resolve a node_file entrypoint from src/*.ts to dist/*.js when the source
   * file doesn't exist on disk (e.g. in Docker where only compiled JS is present).
   */
  private resolveEntrypoint(value: string, type: string, cwd: string): string {
    if (type !== 'node_file') return value;

    const absolute = path.resolve(cwd, value);
    if (fs.existsSync(absolute)) return value;

    // Try src/ → dist/ and .ts → .js
    if (value.startsWith('src/') && value.endsWith('.ts')) {
      const compiled = value.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
      if (fs.existsSync(path.resolve(cwd, compiled))) return compiled;
    }

    return value;
  }
}
