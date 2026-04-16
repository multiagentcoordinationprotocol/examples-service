import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AgentHostAdapter,
  PrepareLaunchInput,
  PreparedLaunch
} from '../contracts/host-adapter.types';
import { AgentFramework, AgentManifest, ManifestValidationResult } from '../contracts/manifest.types';
import { buildAgentEnv } from './agent-env';

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

    const shared = buildAgentEnv(bootstrap, 'custom');
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(manifest.host?.env ?? {}),
      ...shared,
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
