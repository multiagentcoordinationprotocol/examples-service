import { Injectable, Logger, OnModuleInit, HttpStatus } from '@nestjs/common';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

function configError(message: string): AppException {
  return new AppException(ErrorCode.INVALID_CONFIG, message, HttpStatus.INTERNAL_SERVER_ERROR);
}

function readBoolean(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function readNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readStringList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readStringMap(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configError(`${name} must be valid JSON (object of string→string)`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw configError(`${name} must be a JSON object of string→string`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw configError(`${name}[${key}] must be a non-empty string`);
    }
    if (key.trim() === '') continue;
    result[key] = value;
  }
  return result;
}

@Injectable()
export class AppConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppConfigService.name);

  readonly nodeEnv = process.env.NODE_ENV ?? 'development';
  readonly isDevelopment = this.nodeEnv === 'development';

  readonly port = readNumber('PORT', 3000);
  readonly host = process.env.HOST ?? '0.0.0.0';
  readonly corsOrigins = readStringList('CORS_ORIGIN');
  readonly corsOrigin: string | string[] = this.corsOrigins.length > 0 ? this.corsOrigins : 'http://localhost:3000';

  readonly packsDir = process.env.PACKS_DIR ?? './packs';
  readonly registryCacheTtlMs = readNumber('REGISTRY_CACHE_TTL_MS', 0);

  readonly authApiKeys = readStringList('AUTH_API_KEYS');
  readonly logLevel = process.env.LOG_LEVEL ?? 'info';

  readonly controlPlaneBaseUrl = process.env.CONTROL_PLANE_BASE_URL ?? 'http://localhost:3001';
  readonly controlPlaneApiKey = process.env.CONTROL_PLANE_API_KEY;
  readonly controlPlaneTimeoutMs = readNumber('CONTROL_PLANE_TIMEOUT_MS', 10000);
  readonly autoBootstrapExampleAgents = readBoolean('AUTO_BOOTSTRAP_EXAMPLE_AGENTS', true);
  readonly registerPoliciesOnLaunch = readBoolean('REGISTER_POLICIES_ON_LAUNCH', true);
  readonly exampleAgentPythonPath = process.env.EXAMPLE_AGENT_PYTHON_PATH ?? 'python3';
  readonly exampleAgentNodePath = process.env.EXAMPLE_AGENT_NODE_PATH ?? process.execPath;

  /**
   * Per-agent Bearer tokens for direct-to-runtime authentication
   * (RFC-MACP-0004 §4). Map: sender (participantId or agentRef) → Bearer token.
   *
   * Populated from `EXAMPLES_SERVICE_AGENT_TOKENS_JSON`, a JSON object such as:
   *   {"risk-agent":"tok-risk","fraud-agent":"tok-fraud",...}
   *
   * When empty (default), agents fall back to the legacy HTTP-via-control-plane
   * path. When populated, the bootstrap writes the token into `runtime.bearerToken`
   * so the agent opens its own gRPC channel to the runtime.
   */
  readonly agentRuntimeTokens: Record<string, string> = readStringMap('EXAMPLES_SERVICE_AGENT_TOKENS_JSON');

  /**
   * gRPC endpoint that spawned agents connect to directly. Only used when the
   * bootstrap populates `runtime.address`; otherwise agents stay on the legacy
   * HTTP bridge through the control-plane.
   */
  readonly runtimeAddress = process.env.MACP_RUNTIME_ADDRESS ?? '';
  readonly runtimeTls = readBoolean('MACP_RUNTIME_TLS', true);
  /**
   * Escape hatch for local dev only. When `MACP_RUNTIME_TLS=false`, this must
   * also be set to acknowledge the RFC-MACP-0006 §3 violation explicitly. The
   * SDKs enforce the same rule client-side.
   */
  readonly runtimeAllowInsecure = readBoolean('MACP_RUNTIME_ALLOW_INSECURE', false);

  /**
   * Optional host/port that spawned agents bind for the cancel callback HTTP
   * server (RFC-0001 §7.2 / Option A). If `host` is set, each agent binds a
   * per-process port starting from `portBase` (next free port used). Empty
   * host disables the callback server entirely.
   */
  readonly cancelCallbackHost = process.env.MACP_CANCEL_CALLBACK_HOST ?? '127.0.0.1';
  readonly cancelCallbackPortBase = readNumber('MACP_CANCEL_CALLBACK_PORT_BASE', 0);
  readonly cancelCallbackPath = process.env.MACP_CANCEL_CALLBACK_PATH ?? '/agent/cancel';

  resolveAgentToken(senderOrAgentRef: string | undefined): string | undefined {
    if (!senderOrAgentRef) return undefined;
    return this.agentRuntimeTokens[senderOrAgentRef];
  }

  onModuleInit(): void {
    this.logger.log(`packs directory: ${this.packsDir}`);
    this.logger.log(`cache TTL: ${this.registryCacheTtlMs}ms`);
    this.logger.log(`control plane: ${this.controlPlaneBaseUrl}`);
    const agentCount = Object.keys(this.agentRuntimeTokens).length;
    if (agentCount > 0) {
      this.logger.log(
        `direct-agent-auth: ${agentCount} agent token(s) configured; runtime=${this.runtimeAddress || '(unset)'}`
      );
    }
    if (!this.runtimeTls && !this.runtimeAllowInsecure) {
      this.logger.warn(
        'MACP_RUNTIME_TLS=false without MACP_RUNTIME_ALLOW_INSECURE=true: agents will refuse to open the channel (RFC-MACP-0006 §3).'
      );
    }
  }
}

export { readBoolean, readNumber, readStringList, readStringMap };
