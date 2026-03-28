import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess } from 'node:child_process';
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

interface HostedProcessRecord {
  child: ChildProcess;
  launchedAt: string;
  command: string;
  args: string[];
}

@Injectable()
export class ProcessExampleAgentHostProvider implements ExampleAgentHostProvider, OnModuleDestroy {
  private readonly logger = new Logger(ProcessExampleAgentHostProvider.name);
  private readonly processes = new Map<string, HostedProcessRecord>();

  constructor(private readonly config: AppConfigService) {}

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
        processAttached: false
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
    const key = `${context.runId}:${binding.participantId}`;
    const existing = this.processes.get(key);
    if (existing && existing.child.pid) {
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

    const launcher = this.resolveLauncher(definition);
    const entrypoint = this.resolveEntrypoint(definition, launcher);
    const args = [entrypoint, ...(definition.bootstrap.args ?? [])];
    const command = launcher === 'python' ? this.config.exampleAgentPythonPath : this.config.exampleAgentNodePath;

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(definition.bootstrap.env ?? {}),
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
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const launchedAt = new Date().toISOString();
    this.processes.set(key, { child, launchedAt, command, args });
    this.bindProcessLogging(key, child);

    return {
      ...base,
      status: 'bootstrapped',
      participantMetadata: {
        ...(base.participantMetadata ?? {}),
        attachedRunId: context.runId,
        attachedAt: launchedAt,
        pid: child.pid,
        command,
        args,
        processAttached: true
      }
    };
  }

  onModuleDestroy(): void {
    for (const [key, record] of this.processes.entries()) {
      this.logger.log(`terminating example agent process ${key} (pid=${record.child.pid ?? 'n/a'})`);
      try {
        record.child.kill('SIGTERM');
      } catch {
        // best effort cleanup
      }
    }
    this.processes.clear();
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

  private bindProcessLogging(key: string, child: ChildProcess): void {
    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk).trim();
      if (text) {
        this.logger.log(`[${key}] ${text}`);
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk).trim();
      if (text) {
        this.logger.warn(`[${key}] ${text}`);
      }
    });

    child.on('exit', (code, signal) => {
      this.logger.log(`[${key}] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.processes.delete(key);
    });

    child.on('error', (error) => {
      this.logger.error(`[${key}] process error: ${error.message}`);
      this.processes.delete(key);
    });
  }
}
