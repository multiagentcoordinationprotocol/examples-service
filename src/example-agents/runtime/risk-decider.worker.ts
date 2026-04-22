/**
 * Risk-decider agent — initiator/coordinator for the fraud decision scenario.
 *
 * Uses the macp-sdk-typescript Participant to read events from the runtime's
 * gRPC stream. Collects Evaluation/Objection signals from specialist agents,
 * applies a policy strategy, then votes and commits when quorum is met.
 *
 * No control-plane polling — all event flow is agent ↔ runtime via gRPC.
 */
import { agent } from 'macp-sdk-typescript';
const { fromBootstrap } = agent;
type IncomingMessage = agent.IncomingMessage;
type HandlerContext = agent.HandlerContext;
import { loadBootstrapPayload } from './bootstrap-loader';
import { logAgent } from './log-agent';
import { createPolicyStrategy, type SpecialistSignal } from './policy-strategy';

function log(msg: string, details?: Record<string, unknown>): void {
  logAgent(`[risk-decider] ${msg}`, details);
}

function inferOutcomePositive(action: string): boolean {
  return action !== 'decline';
}

async function main(): Promise<void> {
  const bootstrap = loadBootstrapPayload();
  const policyHints = (bootstrap.metadata?.policy_hints ?? {}) as Record<string, unknown>;
  const strategy = createPolicyStrategy(policyHints as Parameters<typeof createPolicyStrategy>[0]);

  const participants = bootstrap.participants ?? [];
  const participantId = bootstrap.participant_id;
  const recipients = participants.filter((p) => p !== participantId);

  // macp-sdk-typescript@0.3.0 reads bootstrap.cancel_callback itself and
  // auto-starts the HTTP listener that POSTs a cancel signal into
  // participant.stop() — no local hand-rolled server needed.
  const participant = fromBootstrap();

  log('risk coordinator started', {
    participantId,
    role: bootstrap.initiator ? 'initiator' : 'participant',
    sessionId: bootstrap.session_id,
    policyType: policyHints.type ?? 'none'
  });

  const signals = new Map<string, SpecialistSignal>();
  let proposalId: string | undefined;
  let committed = false;

  participant.on('Proposal', (message: IncomingMessage) => {
    if (!proposalId) {
      proposalId = message.proposalId ?? undefined;
      log('proposal observed', { proposalId });
    }
  });

  participant.on('Evaluation', (message: IncomingMessage, ctx: HandlerContext) => {
    if (!message.proposalId || message.sender === participantId) return;

    signals.set(message.sender, {
      participantId: message.sender,
      messageType: 'Evaluation',
      recommendation: String(message.payload.recommendation ?? ''),
      confidence: Number(message.payload.confidence ?? 0),
      reason: String(message.payload.reason ?? '')
    });

    void tryCommit(ctx);
  });

  participant.on('Objection', (message: IncomingMessage, ctx: HandlerContext) => {
    if (!message.proposalId || message.sender === participantId) return;

    signals.set(message.sender, {
      participantId: message.sender,
      messageType: 'Objection',
      severity: String(message.payload.severity ?? 'high'),
      reason: String(message.payload.reason ?? '')
    });

    void tryCommit(ctx);
  });

  async function tryCommit(ctx: HandlerContext): Promise<void> {
    if (committed || !proposalId) return;
    if (!strategy.isQuorumMet(signals, recipients.length)) return;

    committed = true;
    const sessionContext = (bootstrap.metadata?.session_context ?? {}) as Record<string, unknown>;
    const decision = strategy.decide(signals, sessionContext);

    log('policy-driven decision', {
      proposalId,
      action: decision.action,
      vote: decision.vote,
      reason: decision.reason,
      policyApplied: decision.policyApplied,
      specialistCount: signals.size
    });

    try {
      await ctx.actions.vote?.({
        proposalId,
        vote: decision.vote === 'approve' ? 'APPROVE' : 'REJECT',
        reason: decision.reason
      });
      log('vote sent', { proposalId, vote: decision.vote });
    } catch (voteError) {
      log('vote send failed', { error: voteError instanceof Error ? voteError.message : String(voteError) });
    }

    try {
      await ctx.actions.commit?.({
        action: decision.action,
        authorityScope: 'transaction_review',
        reason: decision.reason,
        commitmentId: `${proposalId}-final`,
        outcomePositive: inferOutcomePositive(decision.action)
      });
      log('commitment sent', { proposalId, action: decision.action });
    } catch (commitError) {
      log('commitment send failed', {
        error: commitError instanceof Error ? commitError.message : String(commitError)
      });
    }
  }

  participant.onTerminal((_result) => {
    log('session reached terminal state');
  });

  await participant.run();

  log('risk coordinator finished', { participantId });
}

void main().catch((error: unknown) => {
  log('risk coordinator failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
