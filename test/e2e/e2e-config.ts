import * as path from 'node:path';

const fixturesPacksDir = path.resolve(__dirname, '../fixtures/packs');

/**
 * Shared AppConfigService stub for e2e tests. All direct-agent-auth fields
 * default to safe no-op values (empty token map, no runtime address) so
 * agents stay on the HTTP observability path.
 */
export function buildE2eConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const agentRuntimeTokens = (overrides.agentRuntimeTokens ?? {}) as Record<string, string>;
  return {
    packsDir: fixturesPacksDir,
    registryCacheTtlMs: 0,
    corsOrigin: '*',
    isDevelopment: true,
    port: 0,
    host: '0.0.0.0',
    logLevel: 'error',
    controlPlaneBaseUrl: 'http://localhost:3001',
    controlPlaneTimeoutMs: 1000,
    autoBootstrapExampleAgents: true,
    registerPoliciesOnLaunch: false,
    exampleAgentPythonPath: 'python3',
    exampleAgentNodePath: process.execPath,
    authApiKeys: [],
    agentRuntimeTokens,
    runtimeAddress: '',
    runtimeTls: true,
    runtimeAllowInsecure: false,
    cancelCallbackHost: '127.0.0.1',
    cancelCallbackPortBase: 0,
    cancelCallbackPath: '/agent/cancel',
    resolveAgentToken: (key: string | undefined) =>
      key ? agentRuntimeTokens[key] : undefined,
    ...overrides
  };
}
