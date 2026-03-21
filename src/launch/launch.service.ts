import { Injectable } from '@nestjs/common';
import { LaunchSchemaResponse } from '../contracts/launch';
import { RegistryIndexService } from '../registry/registry-index.service';
import { extractSchemaDefaults, deepMerge } from './template-resolver';

@Injectable()
export class LaunchService {
  constructor(private readonly registryIndex: RegistryIndexService) {}

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
    }

    return {
      scenarioRef,
      templateId,
      formSchema: scenario.spec.inputs.schema,
      defaults: resolvedDefaults,
      participants: launch.participants.map((p) => ({
        id: p.id,
        role: p.role,
        agentRef: p.agentRef
      })),
      launchSummary: {
        modeName: launch.modeName,
        modeVersion: launch.modeVersion,
        configurationVersion: launch.configurationVersion,
        ttlMs: launch.ttlMs
      },
      expectedDecisionKinds: scenario.spec.outputs?.expectedDecisionKinds
    };
  }
}
