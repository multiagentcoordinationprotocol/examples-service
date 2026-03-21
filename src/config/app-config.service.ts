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
  readonly corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

  readonly packsDir = process.env.PACKS_DIR ?? './packs';
  readonly registryCacheTtlMs = readNumber('REGISTRY_CACHE_TTL_MS', 0);

  readonly authApiKeys = readStringList('AUTH_API_KEYS');
  readonly logLevel = process.env.LOG_LEVEL ?? 'info';

  onModuleInit(): void {
    this.logger.log(`packs directory: ${this.packsDir}`);
    this.logger.log(`cache TTL: ${this.registryCacheTtlMs}ms`);
  }
}

export { readBoolean, readNumber, readStringList };
