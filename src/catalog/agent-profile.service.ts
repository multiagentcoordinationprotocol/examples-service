import { Injectable } from '@nestjs/common';
import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';
import { RegistryIndexService } from '../registry/registry-index.service';

export interface AgentProfile {
  agentRef: string;
  name: string;
  role: string;
  framework: string;
  description?: string;
  transportIdentity: string;
  entrypoint: string;
  bootstrapStrategy: string;
  bootstrapMode: string;
  tags?: string[];
  scenarios: string[];
}

@Injectable()
export class AgentProfileService {
  constructor(
    private readonly agentCatalog: ExampleAgentCatalogService,
    private readonly registryIndex: RegistryIndexService
  ) {}

  async listProfiles(): Promise<AgentProfile[]> {
    const [definitions, scenarioMap] = await Promise.all([
      Promise.resolve(this.agentCatalog.list()),
      this.buildScenarioCoverageMap()
    ]);

    return definitions.map((definition) => ({
      agentRef: definition.agentRef,
      name: definition.name,
      role: definition.role,
      framework: definition.framework,
      description: definition.description,
      transportIdentity: definition.bootstrap.transportIdentity,
      entrypoint: definition.bootstrap.entrypoint,
      bootstrapStrategy: definition.bootstrap.strategy,
      bootstrapMode: definition.bootstrap.mode,
      tags: definition.tags,
      scenarios: scenarioMap.get(definition.agentRef) ?? []
    }));
  }

  async getProfile(agentRef: string): Promise<AgentProfile> {
    const [definition, scenarioMap] = await Promise.all([
      Promise.resolve(this.agentCatalog.get(agentRef)),
      this.buildScenarioCoverageMap()
    ]);

    return {
      agentRef: definition.agentRef,
      name: definition.name,
      role: definition.role,
      framework: definition.framework,
      description: definition.description,
      transportIdentity: definition.bootstrap.transportIdentity,
      entrypoint: definition.bootstrap.entrypoint,
      bootstrapStrategy: definition.bootstrap.strategy,
      bootstrapMode: definition.bootstrap.mode,
      tags: definition.tags,
      scenarios: scenarioMap.get(definition.agentRef) ?? []
    };
  }

  private async buildScenarioCoverageMap(): Promise<Map<string, string[]>> {
    const coverage = new Map<string, string[]>();
    const snapshot = await this.registryIndex.getSnapshot();

    for (const [, packEntry] of snapshot.packs) {
      const packSlug = packEntry.pack.metadata.slug;

      for (const [scenarioSlug, scenarioEntry] of packEntry.scenarios) {
        for (const [version, versionEntry] of scenarioEntry.versions) {
          const scenarioRef = `${packSlug}/${scenarioSlug}@${version}`;
          const participants = versionEntry.scenario.spec.launch.participants;

          for (const participant of participants) {
            const existing = coverage.get(participant.agentRef);
            if (existing) {
              if (!existing.includes(scenarioRef)) {
                existing.push(scenarioRef);
              }
            } else {
              coverage.set(participant.agentRef, [scenarioRef]);
            }
          }
        }
      }
    }

    return coverage;
  }
}
