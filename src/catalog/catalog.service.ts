import { Injectable } from '@nestjs/common';
import { RegistryIndexService } from '../registry/registry-index.service';
import { PackSummary, ScenarioSummary } from '../contracts/registry';

@Injectable()
export class CatalogService {
  constructor(private readonly registryIndex: RegistryIndexService) {}

  async listPacks(): Promise<PackSummary[]> {
    const snapshot = await this.registryIndex.getSnapshot();
    const packs: PackSummary[] = [];

    for (const [, entry] of snapshot.packs) {
      packs.push({
        slug: entry.pack.metadata.slug,
        name: entry.pack.metadata.name,
        description: entry.pack.metadata.description,
        tags: entry.pack.metadata.tags
      });
    }

    return packs;
  }

  async listScenarios(packSlug: string): Promise<ScenarioSummary[]> {
    const pack = await this.registryIndex.getPack(packSlug);
    const scenarios: ScenarioSummary[] = [];

    for (const [scenarioSlug, scenarioEntry] of pack.scenarios) {
      const versions = Array.from(scenarioEntry.versions.keys());
      const latestVersion = scenarioEntry.versions.get(versions[versions.length - 1]);
      const templates = latestVersion ? Array.from(latestVersion.templates.keys()) : [];

      scenarios.push({
        scenario: scenarioSlug,
        name: latestVersion?.scenario.metadata.name ?? scenarioSlug,
        summary: latestVersion?.scenario.metadata.summary,
        versions,
        templates,
        tags: latestVersion?.scenario.metadata.tags
      });
    }

    return scenarios;
  }
}
