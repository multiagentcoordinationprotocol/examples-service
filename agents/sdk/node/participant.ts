import { BootstrapContext, loadBootstrap, logAgent } from './bootstrap';
import { ControlPlaneClient, CanonicalEvent, RunRecord } from './client';
import {
  MacpMessageBuilder,
  extractPayload,
  extractProposalId,
  extractSender,
  extractMessageType
} from './message-builder';

type JsonRecord = Record<string, unknown>;

export interface Actions {
  evaluate(opts: { proposalId: string; recommendation: string; confidence: number; reason: string; recipients?: string[] }): Promise<void>;
  object(opts: { proposalId: string; reason: string; severity?: string; recipients?: string[] }): Promise<void>;
  vote(opts: { proposalId: string; vote: string; reason: string; recipients?: string[] }): Promise<void>;
  commit(opts: { proposalId: string; action: string; reason: string; recipients?: string[] }): Promise<void>;
}

export interface MessageContext {
  event: JsonRecord;
  payload: JsonRecord;
  proposalId?: string;
  sender?: string;
  bootstrap: BootstrapContext;
  actions: Actions;
}

export type Handler = (ctx: MessageContext) => void | Promise<void>;

const EVENT_TYPE_MAP: Record<string, string> = {
  'proposal.created': 'Proposal',
  'decision.finalized': 'Finalized'
};

function createActions(
  client: ControlPlaneClient,
  builder: MacpMessageBuilder,
  defaultRecipients: string[],
  execution: { modeVersion: string; policyVersion: string; configurationVersion: string }
): Actions {
  return {
    async evaluate({ proposalId, recommendation, confidence, reason, recipients }) {
      const msg = builder.evaluation(proposalId, recommendation, confidence, reason, recipients ?? defaultRecipients);
      await client.sendMessage(msg);
    },
    async object({ proposalId, reason, severity, recipients }) {
      const msg = builder.objection(proposalId, reason, severity ?? 'high', recipients ?? defaultRecipients);
      await client.sendMessage(msg);
    },
    async vote({ proposalId, vote, reason, recipients }) {
      const msg = builder.vote(proposalId, vote, reason, recipients ?? defaultRecipients);
      await client.sendMessage(msg);
    },
    async commit({ proposalId, action, reason, recipients }) {
      const msg = builder.commitment(proposalId, action, reason, {
        modeVersion: execution.modeVersion,
        policyVersion: execution.policyVersion,
        configurationVersion: execution.configurationVersion
      }, recipients ?? defaultRecipients);
      await client.sendMessage(msg);
    }
  };
}

export class Participant {
  readonly bootstrap: BootstrapContext;
  private readonly client: ControlPlaneClient;
  private readonly builder: MacpMessageBuilder;
  private readonly handlers = new Map<string, Handler[]>();
  private readonly actions: Actions;
  private terminalHandler?: (run: RunRecord) => void;
  private finalized = false;

  constructor(bootstrap: BootstrapContext) {
    this.bootstrap = bootstrap;
    this.client = new ControlPlaneClient(bootstrap);
    this.builder = new MacpMessageBuilder(
      bootstrap.run.runId,
      bootstrap.participant.participantId,
      bootstrap.agent.framework,
      bootstrap.participant.agentId
    );

    const others = bootstrap.session.participants.filter(
      (p) => p !== bootstrap.participant.participantId
    );

    this.actions = createActions(this.client, this.builder, others, {
      modeVersion: bootstrap.execution.modeVersion,
      policyVersion: bootstrap.execution.policyVersion ?? '',
      configurationVersion: bootstrap.execution.configurationVersion
    });
  }

  on(eventType: string, handler: Handler): this {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
    return this;
  }

  onTerminal(handler: (run: RunRecord) => void): this {
    this.terminalHandler = handler;
    return this;
  }

  stop(): void {
    this.finalized = true;
  }

  async run(): Promise<void> {
    let afterSeq = 0;
    const ttlMs = this.bootstrap.execution.ttlMs;
    const deadline = Date.now() + Math.min(Math.max(ttlMs + 15000, 60000), 420000);

    logAgent('participant started', {
      participantId: this.bootstrap.participant.participantId,
      runId: this.bootstrap.run.runId,
      framework: this.bootstrap.agent.framework,
      role: this.bootstrap.participant.role
    });

    while (Date.now() < deadline) {
      if (this.finalized) return;

      const run = await this.client.getRun();
      if (this.client.isTerminal(run)) {
        logAgent('run reached terminal status', { status: run.status });
        if (this.terminalHandler) this.terminalHandler(run);
        return;
      }

      const events = await this.client.getEvents(afterSeq, 200);
      for (const event of events) {
        afterSeq = Math.max(afterSeq, event.seq);
        await this.dispatch(event);
        if (this.finalized) return;
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    logAgent('participant timed out', {
      participantId: this.bootstrap.participant.participantId
    });
  }

  private async dispatch(event: CanonicalEvent): Promise<void> {
    const eventRecord = event as unknown as JsonRecord;
    let handlerKey = EVENT_TYPE_MAP[event.type];

    if (handlerKey === undefined && event.type === 'proposal.updated') {
      handlerKey = extractMessageType(eventRecord) ?? undefined;
    }

    if (!handlerKey) return;

    const handlers = this.handlers.get(handlerKey);
    if (!handlers || handlers.length === 0) return;

    const ctx: MessageContext = {
      event: eventRecord,
      payload: extractPayload(eventRecord),
      proposalId: extractProposalId(eventRecord),
      sender: extractSender(eventRecord),
      bootstrap: this.bootstrap,
      actions: this.actions
    };

    for (const handler of handlers) {
      await handler(ctx);
    }
  }
}

export function fromBootstrap(filePath?: string): Participant {
  const bootstrap = loadBootstrap(filePath);
  return new Participant(bootstrap);
}
