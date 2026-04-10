import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentManifest } from './contracts/manifest.types';
import { BootstrapPayload } from './contracts/bootstrap.types';
import { PreparedLaunch, HealthStatus, ParticipantHandle } from './contracts/host-adapter.types';

export interface SupervisedProcess {
  handle: ParticipantHandle;
  child: ChildProcess;
  manifest: AgentManifest;
  launchedAt: string;
  command: string;
  args: string[];
  bootstrapFilePath: string;
  healthStatus: HealthStatus;
  exitCode?: number | null;
  exitSignal?: string | null;
}

@Injectable()
export class LaunchSupervisor implements OnModuleDestroy {
  private readonly logger = new Logger(LaunchSupervisor.name);
  private readonly processes = new Map<string, SupervisedProcess>();

  private makeKey(runId: string, participantId: string): string {
    return `${runId}:${participantId}`;
  }

  writeBootstrapFile(bootstrap: BootstrapPayload): string {
    const dir = path.join(os.tmpdir(), 'macp-bootstrap');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fileName = `${bootstrap.run.runId}_${bootstrap.participant.participantId}_${Date.now()}.json`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(bootstrap, null, 2), 'utf-8');
    return filePath;
  }

  launch(
    prepared: PreparedLaunch,
    manifest: AgentManifest,
    bootstrap: BootstrapPayload,
    bootstrapFilePath: string
  ): SupervisedProcess {
    const { runId } = bootstrap.run;
    const { participantId } = bootstrap.participant;
    const key = this.makeKey(runId, participantId);

    const existing = this.processes.get(key);
    if (existing && existing.child.pid && existing.healthStatus !== 'stopped') {
      this.logger.log(`process already running for ${key} (pid=${existing.child.pid})`);
      return existing;
    }

    const env = {
      ...prepared.env,
      MACP_BOOTSTRAP_FILE: bootstrapFilePath
    };

    const logPrefix = `[${manifest.framework}:${participantId}:${runId}]`;

    this.logger.log(
      `${logPrefix} launching: ${prepared.command} ${prepared.args.join(' ')}`
    );

    const child = spawn(prepared.command, prepared.args, {
      cwd: prepared.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const handle: ParticipantHandle = {
      participantId,
      runId,
      pid: child.pid,
      framework: manifest.framework
    };

    const record: SupervisedProcess = {
      handle,
      child,
      manifest,
      launchedAt: new Date().toISOString(),
      command: prepared.command,
      args: prepared.args,
      bootstrapFilePath,
      healthStatus: 'starting',
      exitCode: undefined,
      exitSignal: undefined
    };

    this.processes.set(key, record);
    this.bindProcessLifecycle(key, logPrefix, record);
    this.setupStartupTimeout(key, logPrefix, prepared.startupTimeoutMs);

    return record;
  }

  getProcess(runId: string, participantId: string): SupervisedProcess | undefined {
    return this.processes.get(this.makeKey(runId, participantId));
  }

  getProcessesForRun(runId: string): SupervisedProcess[] {
    const result: SupervisedProcess[] = [];
    for (const [key, record] of this.processes.entries()) {
      if (key.startsWith(`${runId}:`)) {
        result.push(record);
      }
    }
    return result;
  }

  health(runId: string, participantId: string): HealthStatus {
    const record = this.processes.get(this.makeKey(runId, participantId));
    return record?.healthStatus ?? 'unknown';
  }

  async stop(runId: string, participantId: string, timeoutMs = 5000): Promise<void> {
    const key = this.makeKey(runId, participantId);
    const record = this.processes.get(key);
    if (!record) return;

    const logPrefix = `[${record.manifest.framework}:${participantId}:${runId}]`;
    this.logger.log(`${logPrefix} stopping process (pid=${record.child.pid ?? 'n/a'})`);

    record.healthStatus = 'stopped';

    try {
      record.child.kill('SIGTERM');
    } catch {
      // process may already be dead
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.logger.warn(`${logPrefix} process did not exit after ${timeoutMs}ms, sending SIGKILL`);
        try {
          record.child.kill('SIGKILL');
        } catch {
          // best effort
        }
        resolve();
      }, timeoutMs);

      record.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    this.cleanupBootstrapFile(record.bootstrapFilePath);
    this.processes.delete(key);
  }

  async stopRun(runId: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const processKey of this.processes.keys()) {
      if (processKey.startsWith(`${runId}:`)) {
        const participantId = processKey.split(':')[1];
        promises.push(this.stop(runId, participantId));
      }
    }
    await Promise.all(promises);
  }

  onModuleDestroy(): void {
    for (const [, record] of this.processes.entries()) {
      const logPrefix = `[${record.manifest.framework}:${record.handle.participantId}:${record.handle.runId}]`;
      this.logger.log(`${logPrefix} terminating process on shutdown (pid=${record.child.pid ?? 'n/a'})`);
      try {
        record.child.kill('SIGTERM');
      } catch {
        // best effort
      }
      this.cleanupBootstrapFile(record.bootstrapFilePath);
    }
    this.processes.clear();
  }

  private bindProcessLifecycle(key: string, logPrefix: string, record: SupervisedProcess): void {
    record.child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk).trim();
      if (text) {
        for (const line of text.split('\n')) {
          this.logger.log(`${logPrefix} ${line}`);
        }
      }
    });

    record.child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk).trim();
      if (text) {
        for (const line of text.split('\n')) {
          this.logger.warn(`${logPrefix} ${line}`);
        }
      }
    });

    record.child.on('exit', (code, signal) => {
      record.exitCode = code;
      record.exitSignal = signal;
      record.healthStatus = 'stopped';
      const level = code === 0 ? 'log' : 'warn';
      this.logger[level](
        `${logPrefix} exited code=${code ?? 'null'} signal=${signal ?? 'null'}`
      );
      this.cleanupBootstrapFile(record.bootstrapFilePath);
      this.processes.delete(key);
    });

    record.child.on('error', (error) => {
      record.healthStatus = 'unhealthy';
      this.logger.error(`${logPrefix} process error: ${error.message}`);
      this.processes.delete(key);
    });
  }

  private setupStartupTimeout(key: string, logPrefix: string, timeoutMs: number): void {
    setTimeout(() => {
      const record = this.processes.get(key);
      if (record && record.healthStatus === 'starting') {
        record.healthStatus = 'healthy';
        this.logger.log(`${logPrefix} assumed healthy after ${timeoutMs}ms startup window`);
      }
    }, Math.min(timeoutMs, 5000));
  }

  private cleanupBootstrapFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // best effort cleanup
    }
  }
}
