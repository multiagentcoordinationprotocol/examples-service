import { Injectable, HttpStatus } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { CompileLaunchRequest, CompileLaunchResult, PayloadEnvelope } from '../contracts/launch';
import { ParticipantAgentBinding } from '../contracts/example-agents';
import { ScenarioVersionFile, ScenarioTemplateFile, KickoffTemplate } from '../contracts/registry';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import { RegistryIndexService } from '../registry/registry-index.service';
import { parseScenarioRef, extractSchemaDefaults, deepMerge, substitute } from './template-resolver';

function inferMessageType(kickoff: KickoffTemplate): string {
  if (kickoff.messageType) return kickoff.messageType;
  switch (kickoff.kind) {
    case 'proposal':
      return 'Proposal';
    case 'context':
      return 'Signal';
    case 'broadcast':
      return 'Signal';
    case 'request':
    default:
      return 'Signal';
  }
}

function envelopeFromKickoff(kickoff: KickoffTemplate): PayloadEnvelope | undefined {
  if (kickoff.payloadEnvelope) {
    return kickoff.payloadEnvelope as PayloadEnvelope;
  }
  if (kickoff.payload) {
    return {
      encoding: 'json',
      json: kickoff.payload
    };
  }
  return undefined;
}

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
    let runtime = { ...(scenario.spec.runtime ?? { kind: 'rust', version: 'v1' }) };
    let launch = { ...scenario.spec.launch };
    let execution = { ...(scenario.spec.execution ?? {}) };

    if (request.templateId) {
      const template = await this.registryIndex.getTemplate(packSlug, scenarioSlug, version, request.templateId);
      resolvedDefaults = this.mergeDefaults(resolvedDefaults, template);
      runtime = this.mergeRuntime(runtime, template);
      launch = this.mergeLaunch(launch, template);
      execution = this.mergeExecution(execution, template);
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

    const kickoffTemplate = launch.kickoffTemplate
      ? (substitute(launch.kickoffTemplate, substitutionVars) as KickoffTemplate[])
      : undefined;

    const participantBindings: ParticipantAgentBinding[] = launch.participants.map((participant) => ({
      participantId: participant.id,
      role: participant.role,
      agentRef: participant.agentRef
    }));

    const initiatorParticipantId =
      launch.initiatorParticipantId ?? kickoffTemplate?.[0]?.from ?? launch.participants[0]?.id;

    return {
      executionRequest: {
        mode: request.mode ?? 'sandbox',
        runtime,
        session: {
          modeName: launch.modeName,
          modeVersion: launch.modeVersion,
          configurationVersion: launch.configurationVersion,
          policyVersion: launch.policyVersion,
          ttlMs: launch.ttlMs,
          initiatorParticipantId,
          participants: launch.participants.map((participant) => ({
            id: participant.id,
            role: participant.role,
            transportIdentity: participant.transportIdentity,
            metadata: {
              ...(participant.metadata ?? {}),
              agentRef: participant.agentRef,
              displayName: participant.displayName,
              description: participant.description
            }
          })),
          context,
          metadata: {
            source: 'example-service',
            sourceRef: request.scenarioRef,
            template: request.templateId ?? 'default',
            ...metadataFromTemplate
          }
        },
        kickoff: kickoffTemplate?.map((kickoff) => ({
          from: kickoff.from,
          to: kickoff.to,
          kind: kickoff.kind,
          messageType: inferMessageType(kickoff),
          payload: kickoff.payload,
          payloadEnvelope: envelopeFromKickoff(kickoff),
          metadata: kickoff.metadata
        })),
        execution: {
          idempotencyKey: execution.idempotencyKey,
          tags: Array.from(
            new Set(['example', packSlug, scenarioSlug, ...(execution.tags ?? []), ...(scenario.metadata.tags ?? [])])
          ),
          requester: {
            actorId: execution.requester?.actorId ?? 'example-service',
            actorType: execution.requester?.actorType ?? 'service'
          }
        }
      },
      display: {
        title: scenario.metadata.name,
        scenarioRef: request.scenarioRef,
        templateId: request.templateId,
        expectedDecisionKinds: scenario.spec.outputs?.expectedDecisionKinds
      },
      participantBindings
    };
  }

  private mergeDefaults(
    resolvedDefaults: Record<string, unknown>,
    template: ScenarioTemplateFile
  ): Record<string, unknown> {
    if (!template.spec.defaults) return resolvedDefaults;
    return { ...resolvedDefaults, ...template.spec.defaults };
  }

  private mergeRuntime(
    runtime: { kind: string; version?: string },
    template: ScenarioTemplateFile
  ): { kind: string; version?: string } {
    if (!template.spec.overrides?.runtime) return runtime;
    return { ...runtime, ...template.spec.overrides.runtime };
  }

  private mergeLaunch(
    launch: ScenarioVersionFile['spec']['launch'],
    template: ScenarioTemplateFile
  ): ScenarioVersionFile['spec']['launch'] {
    if (!template.spec.overrides?.launch) return launch;
    return deepMerge(launch, template.spec.overrides.launch) as ScenarioVersionFile['spec']['launch'];
  }

  private mergeExecution(
    execution: NonNullable<ScenarioVersionFile['spec']['execution']>,
    template: ScenarioTemplateFile
  ): NonNullable<ScenarioVersionFile['spec']['execution']> {
    if (!template.spec.overrides?.execution) return execution;
    return deepMerge(execution, template.spec.overrides.execution) as NonNullable<
      ScenarioVersionFile['spec']['execution']
    >;
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
