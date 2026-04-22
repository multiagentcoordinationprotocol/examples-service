/**
 * Risk-decider agent — initiator/coordinator for the fraud decision scenario.
 *
 * Uses the macp-sdk-typescript Participant to read events from the runtime's
 * gRPC stream. Collects Evaluation/Objection signals from specialist agents,
 * applies a policy strategy, then votes and commits when quorum is met.
 *
 * No control-plane polling — all event flow is agent ↔ runtime via gRPC.
 */
import { agent, buildEnvelope, buildSignalPayload } from 'macp-sdk-typescript';
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

async function emitSessionContext(participant: ReturnType<typeof fromBootstrap>, bootstrap: ReturnType<typeof loadBootstrapPayload>): Promise<void> {
  const sessionContext = (bootstrap.metadata?.session_context ?? {}) as Record<string, unknown>;
  if (Object.keys(sessionContext).length === 0) return;

  const payload = buildSignalPayload({
    signalType: 'session.context',
    data: Buffer.from(JSON.stringify(sessionContext), 'utf-8'),
    confidence: 1,
    correlationSessionId: bootstrap.session_id ?? ''
  });
  // Ambient envelope: empty session_id + empty mode (RFC-MACP-0001). Use the
  // proto registry's encodeKnownPayload (the helper that handles plain JS
  // payloads — buildSignalPayload returns a struct, not a protobufjs Message).
  const envelope = buildEnvelope({
    mode: '',
    messageType: 'Signal',
    sessionId: '',
    sender: bootstrap.participant_id,
    payload: participant.client.protoRegistry.encodeKnownPayload('', 'Signal', payload as unknown as Record<string, unknown>)
  });
  try {
    await participant.client.send(envelope, { auth: participant.auth });
    log('session.context signal emitted', { fields: Object.keys(sessionContext).length });
  } catch (err) {
    log('session.context signal failed', { error: err instanceof Error ? err.message : String(err) });
  }
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

  let sessionContextEmitted = false;

  const signals = new Map<string, SpecialistSignal>();
  let proposalId: string | undefined;
  let committed = false;
  let pendingHandlerCtx: HandlerContext | undefined;
  let waitTimer: NodeJS.Timeout | undefined;

  // Max time to wait for all specialists to vote before committing with whatever
  // has arrived. Overridable via env for tests/demos.
  const WAIT_ALL_TIMEOUT_MS = Number(process.env.RISK_DECIDER_WAIT_ALL_TIMEOUT_MS ?? 60_000);

  participant.on('Proposal', (message: IncomingMessage) => {
    if (!proposalId) {
      proposalId = message.proposalId ?? undefined;
      log('proposal observed', { proposalId, expectedSpecialists: recipients.length });

      // Emit session.context once we know CP has had time to create the run
      // (Proposal observation implies SessionStart processed → session bound →
      // CP's WatchSessions has discovered + created the run).
      if (!sessionContextEmitted) {
        sessionContextEmitted = true;
        void emitSessionContext(participant, bootstrap);
      }
      // Arm the deadline. If any specialist crashes / never votes, this
      // commits with whatever signals we have so the session doesn't
      // hang until TTL expiry.
      waitTimer = setTimeout(() => {
        if (!committed && pendingHandlerCtx) {
          log('wait-all deadline reached — forcing commit', {
            received: signals.size,
            expected: recipients.length
          });
          void tryCommit(pendingHandlerCtx, true);
        }
      }, WAIT_ALL_TIMEOUT_MS);
      waitTimer.unref?.();
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

    pendingHandlerCtx = ctx;
    void tryCommit(ctx);
  });

  participant.on('Vote', (message: IncomingMessage, ctx: HandlerContext) => {
    if (!message.proposalId || message.sender === participantId) return;

    const voteValue = String(message.payload.vote ?? '').toUpperCase();
    const recommendation = voteValue === 'APPROVE' ? 'APPROVE' : voteValue === 'ABSTAIN' ? 'REVIEW' : 'BLOCK';

    signals.set(message.sender, {
      participantId: message.sender,
      messageType: 'Evaluation',
      recommendation,
      confidence: 1.0,
      reason: String(message.payload.reason ?? `vote=${voteValue}`)
    });

    pendingHandlerCtx = ctx;
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

    pendingHandlerCtx = ctx;
    void tryCommit(ctx);
  });

  async function tryCommit(ctx: HandlerContext, force = false): Promise<void> {
    if (committed || !proposalId) return;
    // Wait for ALL declared specialists before committing, unless the
    // wait-all deadline forced us through. The strategy's quorum check
    // remains as a defensive lower-bound (avoids committing with zero
    // signals on the deadline path).
    if (!force && signals.size < recipients.length) return;
    if (!strategy.isQuorumMet(signals, recipients.length)) return;

    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = undefined;
    }

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
