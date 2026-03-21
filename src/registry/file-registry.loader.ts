import { Injectable, Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import {
  PackEntry,
  PackFile,
  RegistrySnapshot,
  ScenarioEntry,
  ScenarioTemplateFile,
  ScenarioVersionEntry,
  ScenarioVersionFile
} from '../contracts/registry';

@Injectable()
export class FileRegistryLoader {
  private readonly logger = new Logger(FileRegistryLoader.name);
  private readonly packsDir: string;

  constructor(config: AppConfigService) {
    this.packsDir = path.resolve(config.packsDir);
  }

  async loadAll(): Promise<RegistrySnapshot> {
    const packs = new Map<string, PackEntry>();

    let entries: string[];
    try {
      entries = await fs.readdir(this.packsDir);
    } catch {
      this.logger.warn(`packs directory not found: ${this.packsDir}`);
      return { packs, loadedAt: Date.now() };
    }

    for (const entry of entries) {
      const packDir = path.join(this.packsDir, entry);
      const stat = await fs.stat(packDir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const packYamlPath = path.join(packDir, 'pack.yaml');
      const packYamlExists = await fs
        .access(packYamlPath)
        .then(() => true)
        .catch(() => false);

      if (!packYamlExists) {
        this.logger.warn(`skipping directory without pack.yaml: ${entry}`);
        continue;
      }

      try {
        const pack = await this.loadPackFile(packYamlPath);
        const scenarios = await this.discoverScenarios(packDir);
        packs.set(pack.metadata.slug, { pack, scenarios });
      } catch (err) {
        if (err instanceof AppException) throw err;
        this.logger.error(`failed to load pack ${entry}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`loaded ${packs.size} pack(s)`);
    return { packs, loadedAt: Date.now() };
  }

  private async loadPackFile(filePath: string): Promise<PackFile> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = this.parseYaml(content, filePath) as PackFile;

    if (data.apiVersion !== 'scenarios.macp.dev/v1') {
      throw new AppException(
        ErrorCode.INVALID_PACK_DATA,
        `invalid apiVersion in ${filePath}: ${data.apiVersion}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (data.kind !== 'ScenarioPack') {
      throw new AppException(
        ErrorCode.INVALID_PACK_DATA,
        `invalid kind in ${filePath}: expected ScenarioPack, got ${data.kind}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (!data.metadata?.slug) {
      throw new AppException(
        ErrorCode.INVALID_PACK_DATA,
        `missing metadata.slug in ${filePath}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return data;
  }

  private async discoverScenarios(packDir: string): Promise<Map<string, ScenarioEntry>> {
    const scenariosDir = path.join(packDir, 'scenarios');
    const scenarios = new Map<string, ScenarioEntry>();

    const scenarioDirs = await fs.readdir(scenariosDir).catch(() => [] as string[]);

    for (const scenarioSlug of scenarioDirs) {
      const scenarioDir = path.join(scenariosDir, scenarioSlug);
      const stat = await fs.stat(scenarioDir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const versions = await this.discoverVersions(scenarioDir);
      if (versions.size > 0) {
        scenarios.set(scenarioSlug, { versions });
      }
    }

    return scenarios;
  }

  private async discoverVersions(scenarioDir: string): Promise<Map<string, ScenarioVersionEntry>> {
    const versions = new Map<string, ScenarioVersionEntry>();
    const versionDirs = await fs.readdir(scenarioDir).catch(() => [] as string[]);

    for (const version of versionDirs) {
      const versionDir = path.join(scenarioDir, version);
      const stat = await fs.stat(versionDir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const scenarioYamlPath = path.join(versionDir, 'scenario.yaml');
      const scenarioYamlExists = await fs
        .access(scenarioYamlPath)
        .then(() => true)
        .catch(() => false);

      if (!scenarioYamlExists) continue;

      const scenario = await this.loadScenarioFile(scenarioYamlPath);
      const templates = await this.discoverTemplates(versionDir);
      versions.set(version, { scenario, templates });
    }

    return versions;
  }

  private async loadScenarioFile(filePath: string): Promise<ScenarioVersionFile> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = this.parseYaml(content, filePath) as ScenarioVersionFile;

    if (data.apiVersion !== 'scenarios.macp.dev/v1') {
      throw new AppException(
        ErrorCode.INVALID_PACK_DATA,
        `invalid apiVersion in ${filePath}: ${data.apiVersion}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    if (data.kind !== 'ScenarioVersion') {
      throw new AppException(
        ErrorCode.INVALID_PACK_DATA,
        `invalid kind in ${filePath}: expected ScenarioVersion, got ${data.kind}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return data;
  }

  private async discoverTemplates(versionDir: string): Promise<Map<string, ScenarioTemplateFile>> {
    const templatesDir = path.join(versionDir, 'templates');
    const templates = new Map<string, ScenarioTemplateFile>();

    const files = await fs.readdir(templatesDir).catch(() => [] as string[]);

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

      const filePath = path.join(templatesDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = this.parseYaml(content, filePath) as ScenarioTemplateFile;

      if (data.kind === 'ScenarioTemplate' && data.metadata?.slug) {
        templates.set(data.metadata.slug, data);
      }
    }

    return templates;
  }

  private parseYaml(content: string, filePath: string): unknown {
    try {
      return yaml.load(content, { schema: yaml.JSON_SCHEMA });
    } catch (err) {
      throw new AppException(
        ErrorCode.INVALID_PACK_DATA,
        `invalid YAML in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
