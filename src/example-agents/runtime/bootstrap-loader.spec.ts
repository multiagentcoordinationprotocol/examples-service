import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BootstrapPayload } from '../../hosting/contracts/bootstrap.types';
import { loadBootstrapPayload, hasDirectRuntimeIdentity, isInitiator } from './bootstrap-loader';

function fullBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    participant_id: 'risk-agent',
    session_id: 'sess-uuid-v4',
    mode: 'macp.mode.decision.v1',
    runtime_url: 'runtime.local:50051',
    auth_token: 'tok-risk',
    secure: true,
    allow_insecure: false,
    participants: ['risk-agent'],
    mode_version: '1.0.0',
    configuration_version: 'config.default',
    metadata: {
      run_id: 'run-1',
      scenario_ref: 'fraud/test@1.0.0',
      role: 'coordinator',
      framework: 'custom',
      agent_ref: 'risk-agent'
    },
    ...overrides
  };
}

describe('bootstrap-loader', () => {
  const original = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...original };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macp-bootstrap-loader-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = original;
  });

  function writeBootstrap(payload: BootstrapPayload): string {
    const file = path.join(tmpDir, 'bootstrap.json');
    fs.writeFileSync(file, JSON.stringify(payload), 'utf-8');
    process.env.MACP_BOOTSTRAP_FILE = file;
    return file;
  }

  it('loads a valid bootstrap file', () => {
    writeBootstrap(fullBootstrap());
    const loaded = loadBootstrapPayload();
    expect(loaded.metadata?.run_id).toBe('run-1');
    expect(loaded.runtime_url).toBe('runtime.local:50051');
  });

  it('throws when MACP_BOOTSTRAP_FILE is unset', () => {
    delete process.env.MACP_BOOTSTRAP_FILE;
    expect(() => loadBootstrapPayload()).toThrow(/MACP_BOOTSTRAP_FILE is not set/);
  });

  it('throws on invalid JSON', () => {
    const file = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(file, '{not json', 'utf-8');
    process.env.MACP_BOOTSTRAP_FILE = file;
    expect(() => loadBootstrapPayload()).toThrow(/not valid JSON/);
  });

  it('hasDirectRuntimeIdentity returns true only when runtime_url + auth_token are both present', () => {
    expect(hasDirectRuntimeIdentity(fullBootstrap())).toBe(true);
    expect(hasDirectRuntimeIdentity(fullBootstrap({ auth_token: undefined }))).toBe(false);
    expect(hasDirectRuntimeIdentity(fullBootstrap({ runtime_url: undefined }))).toBe(false);
  });

  it('isInitiator reflects presence of bootstrap.initiator', () => {
    expect(isInitiator(fullBootstrap())).toBe(false);
    expect(
      isInitiator(
        fullBootstrap({
          initiator: {
            session_start: {
              intent: 'x',
              participants: ['risk-agent'],
              ttl_ms: 1000,
              mode_version: '1.0.0',
              configuration_version: 'config.default'
            }
          }
        })
      )
    ).toBe(true);
  });
});
