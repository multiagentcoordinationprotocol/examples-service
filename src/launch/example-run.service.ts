import { Injectable, Logger } from '@nestjs/common';
import { RunExampleRequest, RunExampleResult } from '../contracts/launch';
import { AppConfigService } from '../config/app-config.service';
import { ControlPlaneClient } from '../control-plane/control-plane.client';
import { CompilerService } from '../compiler/compiler.service';
import { HostingService } from '../hosting/hosting.service';
import { PolicyLoaderService } from '../policy/policy-loader.service';

@Injectable()
export class ExampleRunService {
  private readonly logger = new Logger(ExampleRunService.name);

  constructor(
    private readonly compiler: CompilerService,
    private readonly hosting: HostingService,
    private readonly controlPlaneClient: ControlPlaneClient,
    private readonly config: AppConfigService,
    private readonly policyLoader: PolicyLoaderService
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

    // Register policy with control plane before creating run
    if (this.config.registerPoliciesOnLaunch) {
      await this.registerPolicyIfNeeded(compiled.executionRequest.session.policyVersion);
    }

    // Post the scenario-agnostic RunDescriptor (plan CP-1). The control-plane
    // echoes back sessionId — may equal `compiled.sessionId` (we asked CP to
    // reuse it) or a CP-allocated replacement if ours was rejected.
    await this.controlPlaneClient.validate(compiled.runDescriptor);
    const launched = await this.controlPlaneClient.createRun(compiled.runDescriptor);

    // Per direct-agent-auth plan §"End-to-end target flow": the examples-service
    // distributes this sessionId to every spawned agent via bootstrap. The
    // initiator agent emits SessionStart with that sessionId; non-initiators
    // attach via open_stream(). The control-plane reads the same session via
    // GetSession(sessionId) + read-only StreamSession.
    const sessionId = launched.sessionId;
    if (!sessionId) {
      throw new Error('control-plane did not return sessionId; cannot bootstrap agents');
    }
    // Reflect back into compiled state so callers/mocks that still read
    // `executionRequest.session.metadata.sessionId` see the authoritative id.
    compiled.sessionId = sessionId;
    if (compiled.runDescriptor.session.sessionId !== sessionId) {
      compiled.runDescriptor.session.sessionId = sessionId;
    }

    const hostedAgents = shouldBootstrap
      ? await this.hosting.attach(compiled, {
          runId: launched.runId,
          sessionId,
          traceId: launched.traceId,
          scenarioRef: compiled.display.scenarioRef,
          modeName: compiled.executionRequest.session.modeName,
          modeVersion: compiled.executionRequest.session.modeVersion,
          configurationVersion: compiled.executionRequest.session.configurationVersion,
          policyVersion: compiled.executionRequest.session.policyVersion,
          policyHints: compiled.executionRequest.session.policyHints,
          ttlMs: compiled.executionRequest.session.ttlMs,
          sessionContext: compiled.executionRequest.session.context,
          participants: compiled.executionRequest.session.participants.map((participant) => participant.id),
          initiatorParticipantId: compiled.executionRequest.session.initiatorParticipantId,
          initiator: compiled.initiator
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

  private async registerPolicyIfNeeded(policyVersion?: string): Promise<void> {
    if (!policyVersion || policyVersion === 'policy.default') {
      return;
    }

    const policy = this.policyLoader.loadPolicy(policyVersion);
    if (!policy) {
      this.logger.warn(`policy ${policyVersion} not found in local policies directory; skipping registration`);
      return;
    }

    const result = await this.controlPlaneClient.registerPolicy(policy);
    if (result.ok) {
      this.logger.log(`policy ${policyVersion} registered with control plane`);
    } else {
      this.logger.warn(`policy ${policyVersion} registration failed: ${result.error}`);
    }
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
