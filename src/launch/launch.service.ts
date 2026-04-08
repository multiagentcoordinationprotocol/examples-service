import { Injectable } from '@nestjs/common';
import { LaunchSchemaResponse } from '../contracts/launch';
import { RegistryIndexService } from '../registry/registry-index.service';
import { extractSchemaDefaults, deepMerge } from '../compiler/template-resolver';
import { ExampleAgentCatalogService } from '../example-agents/example-agent-catalog.service';

@Injectable()
export class LaunchService {
  constructor(
    private readonly registryIndex: RegistryIndexService,
    private readonly exampleAgents: ExampleAgentCatalogService
  ) {}

  async getLaunchSchema(
    packSlug: string,
    scenarioSlug: string,
    version: string,
    templateSlug?: string
  ): Promise<LaunchSchemaResponse> {
    const scenario = await this.registryIndex.getScenarioVersion(packSlug, scenarioSlug, version);
    const scenarioRef = `${packSlug}/${scenarioSlug}@${version}`;

    const schemaDefaults = extractSchemaDefaults(scenario.spec.inputs.schema);
    let resolvedDefaults = { ...schemaDefaults };
    let launch = scenario.spec.launch;
    let runtime = scenario.spec.runtime ?? { kind: 'rust', version: 'v1' };
    let templateId: string | undefined;

    if (templateSlug) {
      const template = await this.registryIndex.getTemplate(packSlug, scenarioSlug, version, templateSlug);
      templateId = template.metadata.slug;
      if (template.spec.defaults) {
        resolvedDefaults = { ...resolvedDefaults, ...template.spec.defaults };
      }
      if (template.spec.overrides?.launch) {
        launch = deepMerge(launch, template.spec.overrides.launch) as typeof launch;
      }
      if (template.spec.overrides?.runtime) {
        runtime = { ...runtime, ...template.spec.overrides.runtime };
      }
    }

    return {
      scenarioRef,
      templateId,
      formSchema: scenario.spec.inputs.schema,
      defaults: resolvedDefaults,
      participants: launch.participants.map((participant) => ({
        id: participant.id,
        role: participant.role,
        agentRef: participant.agentRef
      })),
      agents: this.exampleAgents.summarizeParticipants(launch.participants),
      runtime,
      launchSummary: {
        modeName: launch.modeName,
        modeVersion: launch.modeVersion,
        configurationVersion: launch.configurationVersion,
        policyVersion: launch.policyVersion,
        policyHints: launch.policyHints,
        ttlMs: launch.ttlMs,
        initiatorParticipantId: launch.initiatorParticipantId
      },
      expectedDecisionKinds: scenario.spec.outputs?.expectedDecisionKinds
    };
  }
}
