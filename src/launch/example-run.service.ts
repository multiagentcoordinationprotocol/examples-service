import { Injectable } from '@nestjs/common';
import { RunExampleRequest, RunExampleResult } from '../contracts/launch';
import { AppConfigService } from '../config/app-config.service';
import { ControlPlaneClient } from '../control-plane/control-plane.client';
import { CompilerService } from '../compiler/compiler.service';
import { HostingService } from '../hosting/hosting.service';

@Injectable()
export class ExampleRunService {
  constructor(
    private readonly compiler: CompilerService,
    private readonly hosting: HostingService,
    private readonly controlPlaneClient: ControlPlaneClient,
    private readonly config: AppConfigService
  ) {}

  async run(request: RunExampleRequest): Promise<RunExampleResult> {
    const compiled = await this.compiler.compile(request);
    this.applyRequestOverrides(compiled, request);
    const shouldBootstrap = request.bootstrapAgents ?? this.config.autoBootstrapExampleAgents;
    const resolvedAgents = shouldBootstrap ? await this.hosting.resolve(compiled) : [];

    if (request.submitToControlPlane === false) {
      return {
        compiled,
        hostedAgents: resolvedAgents,
        controlPlane: {
          baseUrl: this.controlPlaneClient.baseUrl,
          validated: false,
          submitted: false
        }
      };
    }

    await this.controlPlaneClient.validate(compiled.executionRequest);
    const launched = await this.controlPlaneClient.createRun(compiled.executionRequest);

    const hostedAgents = shouldBootstrap
      ? await this.hosting.attach(compiled, {
          runId: launched.runId,
          traceId: launched.traceId,
          scenarioRef: compiled.display.scenarioRef,
          modeName: compiled.executionRequest.session.modeName,
          modeVersion: compiled.executionRequest.session.modeVersion,
          configurationVersion: compiled.executionRequest.session.configurationVersion,
          policyVersion: compiled.executionRequest.session.policyVersion,
          ttlMs: compiled.executionRequest.session.ttlMs,
          sessionContext: compiled.executionRequest.session.context,
          participants: compiled.executionRequest.session.participants.map((participant) => participant.id),
          initiatorParticipantId: compiled.executionRequest.session.initiatorParticipantId
        })
      : [];

    return {
      compiled,
      hostedAgents,
      controlPlane: {
        baseUrl: this.controlPlaneClient.baseUrl,
        validated: true,
        submitted: true,
        runId: launched.runId,
        status: launched.status,
        traceId: launched.traceId
      }
    };
  }

  private applyRequestOverrides(compiled: RunExampleResult['compiled'], request: RunExampleRequest): void {
    if (request.tags && request.tags.length > 0) {
      const existingTags = compiled.executionRequest.execution?.tags ?? [];
      const merged = [...new Set([...existingTags, ...request.tags])];
      compiled.executionRequest.execution = {
        ...(compiled.executionRequest.execution ?? {}),
        tags: merged
      };
    }

    if (request.requester) {
      compiled.executionRequest.execution = {
        ...(compiled.executionRequest.execution ?? {}),
        requester: request.requester
      };
    }

    if (request.runLabel) {
      compiled.executionRequest.session.metadata = {
        ...(compiled.executionRequest.session.metadata ?? {}),
        runLabel: request.runLabel
      };
    }
  }
}
