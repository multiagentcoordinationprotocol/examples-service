import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BootstrapPayload } from '../../hosting/contracts/bootstrap.types';
import {
  loadBootstrapPayload,
  hasDirectRuntimeIdentity,
  isInitiator
} from './bootstrap-loader';

function fullBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    run: { runId: 'run-1', sessionId: 'sess-uuid-v4' },
    participant: { participantId: 'risk-agent', agentId: 'risk-agent', displayName: 'Risk', role: 'coordinator' },
    runtime: {
      address: 'runtime.local:50051',
      bearerToken: 'tok-risk',
      tls: true,
      baseUrl: 'http://localhost:3001',
      messageEndpoint: '/runs/run-1/messages',
      eventsEndpoint: '/runs/run-1/events',
      timeoutMs: 10000,
      joinMetadata: { transport: 'grpc', messageFormat: 'macp' }
    },
    execution: {
      scenarioRef: 'fraud/test@1.0.0',
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      ttlMs: 300000
    },
    session: { context: {}, participants: ['risk-agent'] },
    agent: { manifest: {}, framework: 'custom' },
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
    expect(loaded.run.runId).toBe('run-1');
    expect(loaded.runtime.address).toBe('runtime.local:50051');
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

  it('hasDirectRuntimeIdentity returns true only when address + bearerToken are both present', () => {
    expect(hasDirectRuntimeIdentity(fullBootstrap())).toBe(true);
    expect(
      hasDirectRuntimeIdentity(
        fullBootstrap({ runtime: { ...fullBootstrap().runtime, bearerToken: undefined } })
      )
    ).toBe(false);
    expect(
      hasDirectRuntimeIdentity(
        fullBootstrap({ runtime: { ...fullBootstrap().runtime, address: undefined } })
      )
    ).toBe(false);
  });

  it('isInitiator reflects presence of bootstrap.initiator', () => {
    expect(isInitiator(fullBootstrap())).toBe(false);
    expect(
      isInitiator(
        fullBootstrap({
          initiator: {
            sessionStart: {
              intent: 'x',
              participants: ['risk-agent'],
              ttlMs: 1000,
              modeVersion: '1.0.0',
              configurationVersion: 'config.default'
            }
          }
        })
      )
    ).toBe(true);
  });
});
