import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

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
  readonly exampleAgentPythonPath = process.env.EXAMPLE_AGENT_PYTHON_PATH ?? 'python3';
  readonly exampleAgentNodePath = process.env.EXAMPLE_AGENT_NODE_PATH ?? process.execPath;

  onModuleInit(): void {
    this.logger.log(`packs directory: ${this.packsDir}`);
    this.logger.log(`cache TTL: ${this.registryCacheTtlMs}ms`);
    this.logger.log(`control plane: ${this.controlPlaneBaseUrl}`);
  }
}

export { readBoolean, readNumber, readStringList };
