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

    const session = compiled.runDescriptor.session;
    const hostedAgents = await this.hosting.attach(compiled, {
      runId: sessionId,
      sessionId,
      scenarioRef: compiled.display.scenarioRef,
      modeName: session.modeName,
      modeVersion: session.modeVersion,
      configurationVersion: session.configurationVersion,
      policyVersion: session.policyVersion,
      policyHints: compiled.scenarioMeta.policyHints,
      ttlMs: session.ttlMs,
      sessionContext: compiled.scenarioMeta.sessionContext,
      participants: session.participants.map((p) => p.id),
      initiatorParticipantId: compiled.scenarioMeta.initiatorParticipantId,
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
      const existingTags = compiled.runDescriptor.execution?.tags ?? [];
      const merged = [...new Set([...existingTags, ...request.tags])];
      compiled.runDescriptor.execution = {
        ...(compiled.runDescriptor.execution ?? {}),
        tags: merged
      };
    }

    if (request.requester) {
      compiled.runDescriptor.execution = {
        ...(compiled.runDescriptor.execution ?? {}),
        requester: request.requester
      };
    }

    if (request.runLabel) {
      compiled.runDescriptor.session.metadata = {
        ...(compiled.runDescriptor.session.metadata ?? {}),
        runLabel: request.runLabel
      };
    }
  }
}
