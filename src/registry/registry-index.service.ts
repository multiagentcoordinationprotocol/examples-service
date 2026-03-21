import { Injectable, Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import {
  PackEntry,
  RegistrySnapshot,
  ScenarioTemplateFile,
  ScenarioVersionFile
} from '../contracts/registry';
import { FileRegistryLoader } from './file-registry.loader';

@Injectable()
export class RegistryIndexService {
  private readonly logger = new Logger(RegistryIndexService.name);
  private cachedSnapshot: RegistrySnapshot | null = null;
  private cachedAt = 0;
  private readonly cacheTtlMs: number;

  constructor(
    private readonly loader: FileRegistryLoader,
    private readonly config: AppConfigService
  ) {
    this.cacheTtlMs = config.registryCacheTtlMs;
  }

  async getSnapshot(): Promise<RegistrySnapshot> {
    const now = Date.now();
    if (this.cachedSnapshot && this.cacheTtlMs > 0 && now - this.cachedAt < this.cacheTtlMs) {
      return this.cachedSnapshot;
    }
    this.cachedSnapshot = await this.loader.loadAll();
    this.cachedAt = Date.now();
    return this.cachedSnapshot;
  }

  async getPack(slug: string): Promise<PackEntry> {
    const snapshot = await this.getSnapshot();
    const pack = snapshot.packs.get(slug);
    if (!pack) {
      throw new AppException(ErrorCode.PACK_NOT_FOUND, `pack not found: ${slug}`, HttpStatus.NOT_FOUND);
    }
    return pack;
  }

  async getScenarioVersion(
    packSlug: string,
    scenarioSlug: string,
    version: string
  ): Promise<ScenarioVersionFile> {
    const pack = await this.getPack(packSlug);
    const scenario = pack.scenarios.get(scenarioSlug);
    if (!scenario) {
      throw new AppException(
        ErrorCode.SCENARIO_NOT_FOUND,
        `scenario not found: ${packSlug}/${scenarioSlug}`,
        HttpStatus.NOT_FOUND
      );
    }
    const versionEntry = scenario.versions.get(version);
    if (!versionEntry) {
      throw new AppException(
        ErrorCode.VERSION_NOT_FOUND,
        `version not found: ${packSlug}/${scenarioSlug}@${version}`,
        HttpStatus.NOT_FOUND
      );
    }
    return versionEntry.scenario;
  }

  async getTemplate(
    packSlug: string,
    scenarioSlug: string,
    version: string,
    templateSlug: string
  ): Promise<ScenarioTemplateFile> {
    const pack = await this.getPack(packSlug);
    const scenario = pack.scenarios.get(scenarioSlug);
    if (!scenario) {
      throw new AppException(
        ErrorCode.SCENARIO_NOT_FOUND,
        `scenario not found: ${packSlug}/${scenarioSlug}`,
        HttpStatus.NOT_FOUND
      );
    }
    const versionEntry = scenario.versions.get(version);
    if (!versionEntry) {
      throw new AppException(
        ErrorCode.VERSION_NOT_FOUND,
        `version not found: ${packSlug}/${scenarioSlug}@${version}`,
        HttpStatus.NOT_FOUND
      );
    }
    const template = versionEntry.templates.get(templateSlug);
    if (!template) {
      throw new AppException(
        ErrorCode.TEMPLATE_NOT_FOUND,
        `template not found: ${templateSlug} for ${packSlug}/${scenarioSlug}@${version}`,
        HttpStatus.NOT_FOUND
      );
    }
    return template;
  }

  invalidate(): void {
    this.cachedSnapshot = null;
    this.cachedAt = 0;
    this.logger.log('cache invalidated');
  }
}
