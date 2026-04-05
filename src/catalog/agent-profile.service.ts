import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';
import { RegistryIndexService } from '../registry/registry-index.service';
import { ControlPlaneClient, AgentMetricsEntry } from '../control-plane/control-plane.client';
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
  private readonly logger = new Logger(AgentProfileService.name);

  constructor(
    private readonly agentCatalog: ExampleAgentCatalogService,
    private readonly registryIndex: RegistryIndexService,
    private readonly controlPlaneClient: ControlPlaneClient
  ) {}

  async listProfiles(): Promise<AgentProfile[]> {
    const [definitions, scenarioMap, metricsMap] = await Promise.all([
      Promise.resolve(this.agentCatalog.list()),
      this.buildScenarioCoverageMap(),
      this.fetchAgentMetrics()
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
      scenarios: scenarioMap.get(definition.agentRef) ?? [],
      metrics: this.resolveMetrics(definition.agentRef, metricsMap)
    }));
  }

  async getProfile(agentRef: string): Promise<AgentProfile> {
    const [definition, scenarioMap, metricsMap] = await Promise.all([
      Promise.resolve(this.agentCatalog.get(agentRef)),
      this.buildScenarioCoverageMap(),
      this.fetchAgentMetrics()
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
      scenarios: scenarioMap.get(definition.agentRef) ?? [],
      metrics: this.resolveMetrics(definition.agentRef, metricsMap)
    };
  }

  private resolveMetrics(
    agentRef: string,
    metricsMap: Map<string, AgentMetricsEntry>
  ): AgentProfile['metrics'] {
    const entry = metricsMap.get(agentRef);
    if (!entry) return { runs: 0, signals: 0, averageLatencyMs: 0, averageConfidence: 0 };
    return {
      runs: entry.runs,
      signals: entry.signals,
      averageLatencyMs: 0,
      averageConfidence: entry.averageConfidence
    };
  }

  private async fetchAgentMetrics(): Promise<Map<string, AgentMetricsEntry>> {
    try {
      const entries = await this.controlPlaneClient.getAgentMetrics();
      const map = new Map<string, AgentMetricsEntry>();
      for (const entry of entries) {
        map.set(entry.participantId, entry);
      }
      return map;
    } catch (err) {
      this.logger.warn(`Failed to fetch agent metrics from control plane: ${err instanceof Error ? err.message : String(err)}`);
      return new Map();
    }
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
