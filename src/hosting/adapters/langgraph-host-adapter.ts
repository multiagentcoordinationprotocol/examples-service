import {
  AgentHostAdapter,
  PrepareLaunchInput,
  PreparedLaunch
} from '../contracts/host-adapter.types';
import { AgentFramework, AgentManifest, ManifestValidationResult } from '../contracts/manifest.types';

const DEFAULT_STARTUP_TIMEOUT_MS = 30000;

export class LangGraphHostAdapter implements AgentHostAdapter {
  readonly framework: AgentFramework = 'langgraph';

  validateManifest(manifest: AgentManifest): ManifestValidationResult {
    const errors: string[] = [];

    if (manifest.framework !== 'langgraph') {
      errors.push(`expected framework "langgraph", got "${manifest.framework}"`);
    }

    if (!manifest.entrypoint?.value) {
      errors.push('entrypoint.value is required');
    }

    const entrypointType = manifest.entrypoint?.type;
    if (entrypointType && entrypointType !== 'python_module' && entrypointType !== 'python_file') {
      errors.push(`langgraph entrypoint type must be python_module or python_file, got "${entrypointType}"`);
    }

    const config = manifest.frameworkConfig;
    if (config) {
      if (!config.graphFactory || typeof config.graphFactory !== 'string') {
        errors.push('frameworkConfig.graphFactory is required and must be a string');
      }
      if (!config.inputMapper || typeof config.inputMapper !== 'string') {
        errors.push('frameworkConfig.inputMapper is required and must be a string');
      }
      if (!config.outputMapper || typeof config.outputMapper !== 'string') {
        errors.push('frameworkConfig.outputMapper is required and must be a string');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  prepareLaunch(input: PrepareLaunchInput): PreparedLaunch {
    const { manifest, bootstrap } = input;
    const pythonCmd = manifest.host?.python ?? 'python3';
    const cwd = manifest.host?.cwd ?? process.cwd();
    const entrypoint = manifest.entrypoint.value;

    const args =
      manifest.entrypoint.type === 'python_module'
        ? ['-m', entrypoint, ...(manifest.host?.args ?? [])]
        : [entrypoint, ...(manifest.host?.args ?? [])];

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(manifest.host?.env ?? {}),
      PYTHONUNBUFFERED: '1',
      MACP_BOOTSTRAP_FILE: '',
      MACP_CONTROL_PLANE_URL: bootstrap.runtime.baseUrl,
      MACP_LOG_LEVEL: 'info',
      MACP_FRAMEWORK: 'langgraph',
      MACP_PARTICIPANT_ID: bootstrap.participant.participantId,
      MACP_RUN_ID: bootstrap.run.runId
    };

    return {
      command: pythonCmd,
      args,
      env,
      cwd,
      startupTimeoutMs: manifest.host?.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    };
  }
}
