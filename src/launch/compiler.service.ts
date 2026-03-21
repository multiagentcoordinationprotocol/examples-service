import { Injectable, HttpStatus } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { CompileLaunchRequest, CompileLaunchResult } from '../contracts/launch';
import { ScenarioVersionFile } from '../contracts/registry';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import { RegistryIndexService } from '../registry/registry-index.service';
import { parseScenarioRef, extractSchemaDefaults, deepMerge, substitute } from './template-resolver';

@Injectable()
export class CompilerService {
  private readonly ajv: Ajv;

  constructor(private readonly registryIndex: RegistryIndexService) {
    this.ajv = new Ajv({ allErrors: true, coerceTypes: false });
    addFormats(this.ajv);
  }

  async compile(request: CompileLaunchRequest): Promise<CompileLaunchResult> {
    const { packSlug, scenarioSlug, version } = parseScenarioRef(request.scenarioRef);

    const scenario = await this.registryIndex.getScenarioVersion(packSlug, scenarioSlug, version);

    const schemaDefaults = extractSchemaDefaults(scenario.spec.inputs.schema);
    let resolvedDefaults = { ...schemaDefaults };
    let launch = { ...scenario.spec.launch };

    if (request.templateId) {
      const template = await this.registryIndex.getTemplate(
        packSlug,
        scenarioSlug,
        version,
        request.templateId
      );
      if (template.spec.defaults) {
        resolvedDefaults = { ...resolvedDefaults, ...template.spec.defaults };
      }
      if (template.spec.overrides?.launch) {
        launch = deepMerge(launch, template.spec.overrides.launch) as typeof launch;
      }
    }

    const mergedInputs = {
      ...resolvedDefaults,
      ...request.inputs
    };

    this.validateInputs(scenario, mergedInputs);

    const substitutionVars = { inputs: mergedInputs };

    const context = launch.contextTemplate
      ? (substitute(launch.contextTemplate, substitutionVars) as Record<string, unknown>)
      : undefined;

    const metadataFromTemplate = launch.metadataTemplate
      ? (substitute(launch.metadataTemplate, substitutionVars) as Record<string, unknown>)
      : {};

    const kickoff = launch.kickoffTemplate
      ? (substitute(launch.kickoffTemplate, substitutionVars) as typeof launch.kickoffTemplate)
      : undefined;

    return {
      executionRequest: {
        mode: request.mode ?? 'sandbox',
        runtime: {
          kind: 'default'
        },
        session: {
          modeName: launch.modeName,
          modeVersion: launch.modeVersion,
          configurationVersion: launch.configurationVersion,
          ttlMs: launch.ttlMs,
          participants: launch.participants,
          context,
          metadata: {
            source: 'scenario-registry',
            sourceRef: request.scenarioRef,
            template: request.templateId ?? 'default',
            ...metadataFromTemplate
          }
        },
        kickoff
      },
      display: {
        title: scenario.metadata.name,
        scenarioRef: request.scenarioRef,
        templateId: request.templateId,
        expectedDecisionKinds: scenario.spec.outputs?.expectedDecisionKinds
      }
    };
  }

  private validateInputs(scenario: ScenarioVersionFile, inputs: Record<string, unknown>): void {
    const validate = this.ajv.compile(scenario.spec.inputs.schema);
    if (!validate(inputs)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Input validation failed',
        HttpStatus.BAD_REQUEST,
        { errors: validate.errors }
      );
    }
  }
}
