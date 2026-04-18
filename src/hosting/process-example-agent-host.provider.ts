import { HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ExampleAgentDefinition,
  ExampleAgentRunContext,
  HostedExampleAgent,
  ParticipantAgentBinding
} from '../contracts/example-agents';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import { ExampleAgentHostProvider } from './example-agent-host.provider';
import { HostAdapterRegistry } from './host-adapter-registry';
import { LaunchSupervisor } from './launch-supervisor';
import { ManifestValidator } from './manifest-validator';
import { AgentManifest, AgentFramework } from './contracts/manifest.types';
import { BootstrapPayload } from './contracts/bootstrap.types';

@Injectable()
export class ProcessExampleAgentHostProvider implements ExampleAgentHostProvider, OnModuleDestroy {
  private readonly logger = new Logger(ProcessExampleAgentHostProvider.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly adapterRegistry: HostAdapterRegistry,
    private readonly supervisor: LaunchSupervisor,
    private readonly manifestValidator: ManifestValidator
  ) {}

  async resolve(definition: ExampleAgentDefinition, binding: ParticipantAgentBinding): Promise<HostedExampleAgent> {
    return {
      participantId: binding.participantId,
      agentRef: definition.agentRef,
      name: definition.name,
      role: binding.role,
      framework: definition.framework,
      description: definition.description,
      transportIdentity: definition.bootstrap.transportIdentity,
      entrypoint: definition.bootstrap.entrypoint,
      bootstrapStrategy: definition.bootstrap.strategy,
      bootstrapMode: definition.bootstrap.mode,
      status: 'resolved',
      participantMetadata: {
        role: binding.role,
        agentRef: definition.agentRef,
        framework: definition.framework,
        entrypoint: definition.bootstrap.entrypoint,
        launcher: this.resolveLauncher(definition),
        hostMode: 'external-process',
        processAttached: false,
        adapterAvailable: this.adapterRegistry.has(definition.framework as AgentFramework)
      },
      notes: definition.bootstrap.notes,
      tags: definition.tags
    };
  }

  async attach(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding,
    context: ExampleAgentRunContext
  ): Promise<HostedExampleAgent> {
    const base = await this.resolve(definition, binding);

    const existing = this.supervisor.getProcess(context.runId, binding.participantId);
    if (existing?.child.pid && existing.healthStatus !== 'stopped') {
      return {
        ...base,
        status: 'bootstrapped',
        participantMetadata: {
          ...(base.participantMetadata ?? {}),
          attachedRunId: context.runId,
          attachedAt: existing.launchedAt,
          pid: existing.child.pid,
          command: existing.command,
          args: existing.args,
          processAttached: true
        }
      };
    }

    if (definition.bootstrap.mode !== 'attached') {
      return {
        ...base,
        status: 'bootstrapped',
        participantMetadata: {
          ...(base.participantMetadata ?? {}),
          attachedRunId: context.runId,
          attachedAt: new Date().toISOString(),
          processAttached: false,
          attachmentMode: definition.bootstrap.mode
        }
      };
    }

    const framework = definition.framework as AgentFramework;
    const adapter = this.adapterRegistry.get(framework);

    if (adapter && definition.manifest) {
      return this.launchViaAdapter(definition, binding, context, base);
    }

    return this.launchLegacy(definition, binding, context, base);
  }

  onModuleDestroy(): void {
    this.supervisor.onModuleDestroy();
  }

  private async launchViaAdapter(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding,
    context: ExampleAgentRunContext,
    base: HostedExampleAgent
  ): Promise<HostedExampleAgent> {
    const manifest = definition.manifest as AgentManifest;
    const framework = definition.framework as AgentFramework;
    const adapter = this.adapterRegistry.getOrThrow(framework);

    const validation = this.manifestValidator.validate(manifest);
    if (!validation.valid) {
      this.logger.error(`manifest validation failed for ${definition.agentRef}: ${validation.errors.join('; ')}`);
      return {
        ...base,
        status: 'resolved',
        participantMetadata: {
          ...(base.participantMetadata ?? {}),
          attachedRunId: context.runId,
          processAttached: false,
          manifestErrors: validation.errors
        }
      };
    }

    const bootstrap = this.buildBootstrapPayload(definition, binding, context, manifest);
    const bootstrapFilePath = this.supervisor.writeBootstrapFile(bootstrap);
    const prepared = adapter.prepareLaunch({ manifest, bootstrap });

    const record = this.supervisor.launch(prepared, manifest, bootstrap, bootstrapFilePath);

    return {
      ...base,
      status: 'bootstrapped',
      participantMetadata: {
        ...(base.participantMetadata ?? {}),
        attachedRunId: context.runId,
        attachedAt: record.launchedAt,
        pid: record.child.pid,
        command: record.command,
        args: record.args,
        processAttached: true,
        launchMode: 'adapter',
        adapterFramework: framework
      }
    };
  }

  private launchLegacy(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding,
    context: ExampleAgentRunContext,
    base: HostedExampleAgent
  ): HostedExampleAgent {
    const launcher = this.resolveLauncher(definition);
    const entrypoint = this.resolveEntrypoint(definition, launcher);
    const command = launcher === 'python' ? this.config.exampleAgentPythonPath : this.config.exampleAgentNodePath;

    const manifest: AgentManifest = {
      id: definition.agentRef,
      name: definition.name,
      framework: (definition.framework === 'mock' ? 'custom' : definition.framework) as AgentFramework,
      entrypoint: {
        type: launcher === 'python' ? 'python_file' : 'node_file',
        value: definition.bootstrap.entrypoint
      },
      host: {
        python: this.config.exampleAgentPythonPath,
        node: this.config.exampleAgentNodePath,
        env: definition.bootstrap.env
      }
    };

    const bootstrap = this.buildBootstrapPayload(definition, binding, context, manifest);
    const bootstrapFilePath = this.supervisor.writeBootstrapFile(bootstrap);

    const args = [entrypoint, ...(definition.bootstrap.args ?? [])];
    const bearerToken = this.resolveAgentToken(binding, definition);
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(definition.bootstrap.env ?? {}),
      MACP_BOOTSTRAP_FILE: bootstrapFilePath,
      MACP_LOG_LEVEL: 'info',
      MACP_FRAMEWORK: definition.framework,
      MACP_PARTICIPANT_ID: binding.participantId,
      MACP_RUN_ID: context.runId,
      MACP_SESSION_ID: context.sessionId ?? '',
      MACP_RUNTIME_ADDRESS: this.config.runtimeAddress,
      MACP_RUNTIME_TLS: String(this.config.runtimeTls),
      MACP_RUNTIME_ALLOW_INSECURE: String(this.config.runtimeAllowInsecure),
      MACP_RUNTIME_TOKEN: bearerToken ?? ''
    };

    const prepared = {
      command,
      args,
      env,
      cwd: process.cwd(),
      startupTimeoutMs: 15000
    };

    const record = this.supervisor.launch(prepared, manifest, bootstrap, bootstrapFilePath);

    return {
      ...base,
      status: 'bootstrapped',
      participantMetadata: {
        ...(base.participantMetadata ?? {}),
        attachedRunId: context.runId,
        attachedAt: record.launchedAt,
        pid: record.child.pid,
        command,
        args,
        processAttached: true,
        launchMode: 'legacy'
      }
    };
  }

  private buildBootstrapPayload(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding,
    context: ExampleAgentRunContext,
    _manifest: AgentManifest
  ): BootstrapPayload {
    const runtimeAddress = this.config.runtimeAddress || '';
    const bearerToken = this.resolveAgentToken(binding, definition);
    const isInitiator = context.initiator?.participantId === binding.participantId;
    const cancelCb = this.allocateCancelCallback(binding.participantId, context.runId);

    const initiatorData = context.initiator;

    return {
      participant_id: binding.participantId,
      session_id: context.sessionId ?? '',
      mode: context.modeName,
      runtime_url: runtimeAddress,
      auth_token: bearerToken,
      secure: this.config.runtimeTls,
      allow_insecure: this.config.runtimeAllowInsecure,
      participants: context.participants,
      mode_version: context.modeVersion,
      configuration_version: context.configurationVersion,
      policy_version: context.policyVersion,
      initiator:
        isInitiator && initiatorData
          ? {
              session_start: {
                intent: initiatorData.sessionStart.intent,
                participants: initiatorData.sessionStart.participants,
                ttl_ms: initiatorData.sessionStart.ttlMs,
                mode_version: initiatorData.sessionStart.modeVersion,
                configuration_version: initiatorData.sessionStart.configurationVersion,
                policy_version: initiatorData.sessionStart.policyVersion,
                context: initiatorData.sessionStart.context,
                context_id: initiatorData.sessionStart.contextId,
                extensions: initiatorData.sessionStart.extensions,
                roots: initiatorData.sessionStart.roots
              },
              kickoff: initiatorData.kickoff
                ? {
                    message_type: initiatorData.kickoff.messageType,
                    payload_type: initiatorData.kickoff.payloadType,
                    payload: initiatorData.kickoff.payload
                  }
                : undefined
            }
          : undefined,
      cancel_callback: cancelCb,
      metadata: {
        run_id: context.runId,
        trace_id: context.traceId,
        scenario_ref: context.scenarioRef,
        role: binding.role,
        framework: definition.framework,
        agent_ref: definition.agentRef,
        policy_hints: context.policyHints,
        session_context: context.sessionContext
      }
    };
  }

  private resolveAgentToken(binding: ParticipantAgentBinding, definition: ExampleAgentDefinition): string | undefined {
    return this.config.resolveAgentToken(binding.participantId) ?? this.config.resolveAgentToken(definition.agentRef);
  }

  private allocateCancelCallback(participantId: string, runId: string): BootstrapPayload['cancel_callback'] {
    const host = this.config.cancelCallbackHost;
    if (!host) return undefined;
    const base = this.config.cancelCallbackPortBase;
    if (!base || base <= 0) {
      // No port base configured; agents will listen on an ephemeral port and
      // POST the port back to the control-plane via a future registration
      // call. For now we just record host+path and let the agent bind :0.
      return { host, port: 0, path: this.config.cancelCallbackPath };
    }
    const port = this.nextCancelCallbackPort(base, runId, participantId);
    return { host, port, path: this.config.cancelCallbackPath };
  }

  private nextCancelCallbackPort(base: number, runId: string, participantId: string): number {
    // Deterministic offset so the same (runId, participantId) always lands on
    // the same port within a process — avoids collisions when launching the
    // same scenario repeatedly against a single host.
    let hash = 0;
    const material = `${runId}:${participantId}`;
    for (let i = 0; i < material.length; i += 1) {
      hash = (hash * 31 + material.charCodeAt(i)) | 0;
    }
    const offset = Math.abs(hash) % 1024;
    return base + offset;
  }

  private resolveLauncher(definition: ExampleAgentDefinition): 'node' | 'python' {
    if (definition.bootstrap.launcher) {
      return definition.bootstrap.launcher;
    }
    return definition.bootstrap.entrypoint.endsWith('.py') ? 'python' : 'node';
  }

  private resolveEntrypoint(definition: ExampleAgentDefinition, launcher: 'node' | 'python'): string {
    const logicalEntrypoint = definition.bootstrap.entrypoint;
    const diskPath =
      launcher === 'node'
        ? this.resolveNodeEntrypoint(logicalEntrypoint)
        : path.resolve(process.cwd(), logicalEntrypoint);

    if (!fs.existsSync(diskPath)) {
      throw new AppException(
        ErrorCode.INTERNAL_ERROR,
        `example agent entrypoint not found: ${diskPath}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    return diskPath;
  }

  private resolveNodeEntrypoint(logicalEntrypoint: string): string {
    const compiled = logicalEntrypoint.startsWith('src/')
      ? logicalEntrypoint.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js')
      : logicalEntrypoint.replace(/\.ts$/, '.js');
    return path.resolve(process.cwd(), compiled);
  }
}
