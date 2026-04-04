import { Injectable, HttpStatus } from '@nestjs/common';
import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';
import { RegistryIndexService } from '../registry/registry-index.service';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

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
  metrics: {
    runs: number;
    signals: number;
    averageLatencyMs: number;
    averageConfidence: number;
  };
}

@Injectable()
export class AgentProfileService {
  constructor(
    private readonly agentCatalog: ExampleAgentCatalogService,
    private readonly registryIndex: RegistryIndexService
  ) {}

  async listProfiles(): Promise<AgentProfile[]> {
    const definitions = this.agentCatalog.list();
    const scenarioMap = await this.buildScenarioCoverageMap();

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
      scenarios: scenarioMap.get(definition.agentRef) ?? [],
      metrics: { runs: 0, signals: 0, averageLatencyMs: 0, averageConfidence: 0 }
    }));
  }

  async getProfile(agentRef: string): Promise<AgentProfile> {
    const definition = this.agentCatalog.get(agentRef);
    const scenarioMap = await this.buildScenarioCoverageMap();

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
      scenarios: scenarioMap.get(definition.agentRef) ?? [],
      metrics: { runs: 0, signals: 0, averageLatencyMs: 0, averageConfidence: 0 }
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
