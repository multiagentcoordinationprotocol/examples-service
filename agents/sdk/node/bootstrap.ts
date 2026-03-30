import * as fs from 'node:fs';

type JsonRecord = Record<string, unknown>;

export interface BootstrapContext {
  run: { runId: string; sessionId?: string; traceId?: string };
  participant: { participantId: string; agentId: string; displayName: string; role: string };
  runtime: {
    baseUrl: string;
    messageEndpoint: string;
    eventsEndpoint: string;
    apiKey?: string;
    timeoutMs: number;
  };
  execution: {
    scenarioRef: string;
    modeName: string;
    modeVersion: string;
    configurationVersion: string;
    policyVersion?: string;
    ttlMs: number;
    initiatorParticipantId?: string;
    tags?: string[];
    requester?: string;
  };
  session: { context: JsonRecord; participants: string[]; metadata?: JsonRecord };
  agent: { manifest: JsonRecord; framework: string; frameworkConfig?: JsonRecord };
  kickoff?: { messageType: string; payload: JsonRecord };
}

export function loadBootstrap(filePath?: string): BootstrapContext {
  const path = filePath ?? process.env.MACP_BOOTSTRAP_FILE;
  if (!path) {
    throw new Error('MACP_BOOTSTRAP_FILE environment variable is not set and no filePath was provided');
  }

  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return raw as BootstrapContext;
}

export function specialistRecipients(ctx: BootstrapContext): string[] {
  if (ctx.execution.initiatorParticipantId) {
    return [ctx.execution.initiatorParticipantId];
  }
  return ctx.session.participants.filter((p) => p !== ctx.participant.participantId);
}

export function logAgent(message: string, details?: JsonRecord): void {
  const payload = details
    ? { ts: new Date().toISOString(), message, ...details }
    : { ts: new Date().toISOString(), message };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
