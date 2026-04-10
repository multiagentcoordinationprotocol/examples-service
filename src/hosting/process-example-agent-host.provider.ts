import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ExampleAgentDefinition,
  ExampleAgentRunContext,
  HostedExampleAgent,
  ParticipantAgentBinding
} from '../contracts/example-agents';
import { AppConfigService } from '../config/app-config.service';
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

  async resolve(
    definition: ExampleAgentDefinition,
    binding: ParticipantAgentBinding
  ): Promise<HostedExampleAgent> {
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
    if (existing && existing.child.pid && existing.healthStatus !== 'stopped') {
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
      this.logger.error(
        `manifest validation failed for ${definition.agentRef}: ${validation.errors.join('; ')}`
      );
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
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(definition.bootstrap.env ?? {}),
      MACP_BOOTSTRAP_FILE: bootstrapFilePath,
      MACP_CONTROL_PLANE_URL: this.config.controlPlaneBaseUrl,
      MACP_LOG_LEVEL: 'info',
      MACP_FRAMEWORK: definition.framework,
      MACP_PARTICIPANT_ID: binding.participantId,
      MACP_RUN_ID: context.runId,
      CONTROL_PLANE_BASE_URL: this.config.controlPlaneBaseUrl,
      CONTROL_PLANE_API_KEY: this.config.controlPlaneApiKey ?? '',
      CONTROL_PLANE_TIMEOUT_MS: String(this.config.controlPlaneTimeoutMs ?? 10000),
      EXAMPLE_AGENT_RUN_ID: context.runId,
      EXAMPLE_AGENT_TRACE_ID: context.traceId ?? '',
      EXAMPLE_AGENT_SCENARIO_REF: context.scenarioRef,
      EXAMPLE_AGENT_MODE_NAME: context.modeName,
      EXAMPLE_AGENT_MODE_VERSION: context.modeVersion,
      EXAMPLE_AGENT_CONFIGURATION_VERSION: context.configurationVersion,
      EXAMPLE_AGENT_POLICY_VERSION: context.policyVersion ?? '',
      EXAMPLE_AGENT_POLICY_HINTS_JSON: JSON.stringify(context.policyHints ?? {}),
      EXAMPLE_AGENT_SESSION_TTL_MS: String(context.ttlMs),
      EXAMPLE_AGENT_CONTEXT_JSON: JSON.stringify(context.sessionContext ?? {}),
      EXAMPLE_AGENT_INITIATOR_PARTICIPANT_ID: context.initiatorParticipantId ?? '',
      EXAMPLE_AGENT_PARTICIPANTS_JSON: JSON.stringify(context.participants),
      EXAMPLE_AGENT_REF: definition.agentRef,
      EXAMPLE_AGENT_PARTICIPANT_ID: binding.participantId,
      EXAMPLE_AGENT_ROLE: binding.role,
      EXAMPLE_AGENT_FRAMEWORK: definition.framework,
      EXAMPLE_AGENT_TRANSPORT_IDENTITY: definition.bootstrap.transportIdentity,
      EXAMPLE_AGENT_ENTRYPOINT: definition.bootstrap.entrypoint
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
    manifest: AgentManifest
  ): BootstrapPayload {
    return {
      run: {
        runId: context.runId,
        traceId: context.traceId
      },
      participant: {
        participantId: binding.participantId,
        agentId: definition.agentRef,
        displayName: definition.name,
        role: binding.role
      },
      runtime: {
        baseUrl: this.config.controlPlaneBaseUrl,
        messageEndpoint: `/runs/${context.runId}/messages`,
        eventsEndpoint: `/runs/${context.runId}/events`,
        apiKey: this.config.controlPlaneApiKey,
        timeoutMs: this.config.controlPlaneTimeoutMs,
        joinMetadata: {
          transport: 'http',
          messageFormat: 'macp'
        }
      },
      execution: {
        scenarioRef: context.scenarioRef,
        modeName: context.modeName,
        modeVersion: context.modeVersion,
        configurationVersion: context.configurationVersion,
        policyVersion: context.policyVersion,
        policyHints: context.policyHints,
        ttlMs: context.ttlMs,
        initiatorParticipantId: context.initiatorParticipantId,
        requester: 'example-service'
      },
      session: {
        context: context.sessionContext ?? {},
        participants: context.participants
      },
      agent: {
        manifest: manifest as unknown as Record<string, unknown>,
        framework: definition.framework,
        frameworkConfig: manifest.frameworkConfig
      }
    };
  }

  private resolveLauncher(definition: ExampleAgentDefinition): 'node' | 'python' {
    if (definition.bootstrap.launcher) {
      return definition.bootstrap.launcher;
    }
    return definition.bootstrap.entrypoint.endsWith('.py') ? 'python' : 'node';
  }

  private resolveEntrypoint(
    definition: ExampleAgentDefinition,
    launcher: 'node' | 'python'
  ): string {
    const logicalEntrypoint = definition.bootstrap.entrypoint;
    const diskPath = launcher === 'node'
      ? this.resolveNodeEntrypoint(logicalEntrypoint)
      : path.resolve(process.cwd(), logicalEntrypoint);

    if (!fs.existsSync(diskPath)) {
      throw new Error(`example agent entrypoint not found: ${diskPath}`);
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
