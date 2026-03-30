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
    const entrypoint = manifest.entrypoint.value;

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
      MACP_RUN_ID: bootstrap.run.runId
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
}
