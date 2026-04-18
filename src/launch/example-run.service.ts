import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RunExampleRequest, RunExampleResult } from '../contracts/launch';
import { AppConfigService } from '../config/app-config.service';
import { CompilerService } from '../compiler/compiler.service';
import { HostingService } from '../hosting/hosting.service';

@Injectable()
export class ExampleRunService {
  private readonly logger = new Logger(ExampleRunService.name);

  constructor(
    private readonly compiler: CompilerService,
    private readonly hosting: HostingService,
    private readonly config: AppConfigService
  ) {}

  async run(request: RunExampleRequest): Promise<RunExampleResult> {
    const compiled = await this.compiler.compile(request);
    this.applyRequestOverrides(compiled, request);
    const shouldBootstrap = request.bootstrapAgents ?? this.config.autoBootstrapExampleAgents;
    const resolvedAgents = shouldBootstrap ? await this.hosting.resolve(compiled) : [];

    if (!shouldBootstrap) {
      return { compiled, hostedAgents: resolvedAgents };
    }

    const sessionId = compiled.sessionId || randomUUID();
    compiled.sessionId = sessionId;

    const hostedAgents = await this.hosting.attach(compiled, {
      runId: sessionId,
      sessionId,
      scenarioRef: compiled.display.scenarioRef,
      modeName: compiled.executionRequest.session.modeName,
      modeVersion: compiled.executionRequest.session.modeVersion,
      configurationVersion: compiled.executionRequest.session.configurationVersion,
      policyVersion: compiled.executionRequest.session.policyVersion,
      policyHints: compiled.executionRequest.session.policyHints,
      ttlMs: compiled.executionRequest.session.ttlMs,
      sessionContext: compiled.executionRequest.session.context,
      participants: compiled.executionRequest.session.participants.map((p) => p.id),
      initiatorParticipantId: compiled.executionRequest.session.initiatorParticipantId,
      initiator: compiled.initiator
    });

    this.logger.log(
      `Scenario launched: sessionId=${sessionId} scenario=${compiled.display.scenarioRef} agents=${hostedAgents.length}`
    );

    return {
      compiled,
      hostedAgents,
      sessionId
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
