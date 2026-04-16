/**
 * Risk-decider agent — custom Node.js worker.
 *
 * Direct-agent-auth flow (RFC-MACP-0004 §4):
 *   1. Load bootstrap with this agent's own gRPC address + Bearer token.
 *   2. Open a `MacpClient` and call `initialize()`.
 *   3. If initiator: `session.start(...)` → `session.propose(...)`.
 *      Else: `session.openStream()` and react to events.
 *   4. Bind cancel callback HTTP server (RFC-0001 §7.2 Option A).
 *   5. Continue reading events via the legacy control-plane observability
 *      HTTP route (read-only) to drive policy-quorum logic.
 */
import { Auth, MacpClient, DecisionSession } from 'macp-sdk-typescript';
import {
  ControlPlaneAgentClient,
  extractDecodedPayload,
  extractMessageType,
  extractProposalId,
  extractSender,
  loadAgentRuntimeContext,
  logAgent
} from './control-plane-agent-client';
import { loadBootstrapPayload, hasDirectRuntimeIdentity, isInitiator } from './bootstrap-loader';
import { startCancelCallbackServer, CancelCallbackServer } from './cancel-callback-server';
import { createPolicyStrategy, SpecialistSignal } from './policy-strategy';

function inferOutcomePositive(action: string): boolean {
  return action !== 'decline';
}

async function main(): Promise<void> {
  const bootstrap = loadBootstrapPayload();
  const context = loadAgentRuntimeContext();
  const strategy = createPolicyStrategy(context.policyHints);
  const deadline = Date.now() + Math.min(Math.max(context.ttlMs + 15000, 60000), 420000);
  const recipients = context.participants.filter((p) => p !== context.participantId);
  const observability = new ControlPlaneAgentClient();

  if (!hasDirectRuntimeIdentity(bootstrap)) {
    throw new Error(
      'risk-decider: bootstrap.runtime.address + bootstrap.runtime.bearerToken are required. ' +
        'Populate EXAMPLES_SERVICE_AGENT_TOKENS_JSON and MACP_RUNTIME_ADDRESS on the examples-service.'
    );
  }

  const sessionId = bootstrap.run.sessionId;
  if (!sessionId) {
    throw new Error('risk-decider: bootstrap.run.sessionId is empty; examples-service must pre-allocate it.');
  }

  const client = new MacpClient({
    address: bootstrap.runtime.address!,
    secure: bootstrap.runtime.tls ?? true,
    allowInsecure: bootstrap.runtime.allowInsecure ?? false,
    auth: Auth.bearer(bootstrap.runtime.bearerToken!, { expectedSender: bootstrap.participant.participantId })
  });

  try {
    await client.initialize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAgent('runtime initialize failed', { error: message });
    throw error;
  }

  const session = new DecisionSession(client, {
    sessionId,
    modeVersion: bootstrap.execution.modeVersion,
    configurationVersion: bootstrap.execution.configurationVersion,
    policyVersion: bootstrap.execution.policyVersion
  });

  let cancelled = false;
  let cancelServer: CancelCallbackServer | undefined;
  if (bootstrap.cancelCallback) {
    cancelServer = await startCancelCallbackServer({
      host: bootstrap.cancelCallback.host,
      port: bootstrap.cancelCallback.port,
      path: bootstrap.cancelCallback.path,
      onCancel: async ({ reason }) => {
        if (cancelled) return;
        cancelled = true;
        logAgent('cancel callback received', { reason });
        try {
          await session.cancel(reason ?? 'cancelled by control plane');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logAgent('cancel forward to runtime failed', { error: message });
        }
      }
    });
    logAgent('cancel callback listening', { address: cancelServer.address });
  }

  logAgent('risk coordinator started', {
    participantId: context.participantId,
    scenarioRef: context.scenarioRef,
    policyType: context.policyHints?.type ?? 'none',
    policyVersion: context.policyVersion ?? '',
    sessionId,
    role: isInitiator(bootstrap) ? 'initiator' : 'participant'
  });

  if (isInitiator(bootstrap)) {
    await emitInitiatorEnvelopes(session, bootstrap);
  }

  let afterSeq = 0;
  let proposalId: string | undefined;
  let committed = false;
  const signals = new Map<string, SpecialistSignal>();

  try {
    while (Date.now() < deadline && !cancelled) {
      const run = await observability.getRun(context.runId);
      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        logAgent('run reached terminal status; exiting coordinator', { status: run.status });
        return;
      }

      const events = await observability.getEvents(context.runId, afterSeq, 200);
      for (const event of events) {
        afterSeq = Math.max(afterSeq, event.seq);

        if (event.type === 'decision.finalized') {
          logAgent('decision already finalized; exiting coordinator', { seq: event.seq });
          return;
        }

        if (
          !proposalId &&
          (event.type === 'proposal.created' ||
            (event.type === 'message.sent' && extractMessageType(event) === 'Proposal'))
        ) {
          proposalId = extractProposalId(event);
          if (proposalId) {
            logAgent('proposal observed', { proposalId, seq: event.seq });
          }
          continue;
        }

        if (!proposalId) continue;
        if (
          event.type !== 'proposal.updated' &&
          !(event.type === 'message.received' || event.type === 'message.sent')
        ) {
          continue;
        }

        const eventProposalId = extractProposalId(event);
        if (!eventProposalId || eventProposalId !== proposalId) continue;

        const sender = extractSender(event);
        const messageType = extractMessageType(event);
        if (!sender || sender === context.participantId || !messageType) continue;

        if (messageType === 'Evaluation') {
          const payload = extractDecodedPayload(event);
          signals.set(sender, {
            participantId: sender,
            messageType: 'Evaluation',
            recommendation: String(payload.recommendation ?? ''),
            confidence: Number(payload.confidence ?? 0),
            reason: String(payload.reason ?? '')
          });
        } else if (messageType === 'Objection') {
          const payload = extractDecodedPayload(event);
          signals.set(sender, {
            participantId: sender,
            messageType: 'Objection',
            severity: String(payload.severity ?? 'high'),
            reason: String(payload.reason ?? '')
          });
        }
      }

      if (proposalId && !committed && strategy.isQuorumMet(signals, recipients.length)) {
        committed = true;
        const decision = strategy.decide(signals, context.sessionContext);

        logAgent('policy-driven decision', {
          proposalId,
          action: decision.action,
          vote: decision.vote,
          reason: decision.reason,
          policyApplied: decision.policyApplied,
          specialistCount: signals.size
        });

        try {
          await session.vote({
            proposalId,
            vote: decision.vote === 'approve' ? 'APPROVE' : 'REJECT',
            reason: decision.reason
          });
          logAgent('vote sent', { proposalId, vote: decision.vote });
        } catch (voteError) {
          logAgent('vote send failed (continuing)', {
            error: voteError instanceof Error ? voteError.message : String(voteError)
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 250));

        try {
          await session.commit({
            action: decision.action,
            authorityScope: 'transaction_review',
            reason: decision.reason,
            commitmentId: `${proposalId}-final`,
            outcomePositive: inferOutcomePositive(decision.action)
          });
          logAgent('commitment sent, awaiting policy evaluation', {
            proposalId,
            action: decision.action
          });
        } catch (commitError) {
          logAgent('commitment send failed', {
            error: commitError instanceof Error ? commitError.message : String(commitError)
          });
        }

        let policyResolved = false;
        const evalDeadline = Date.now() + 5000;
        while (Date.now() < evalDeadline && !policyResolved) {
          const newEvents = await observability.getEvents(context.runId, afterSeq, 50);
          for (const ev of newEvents) {
            afterSeq = Math.max(afterSeq, ev.seq);
            if (ev.type === 'policy.commitment.evaluated' || ev.type === 'policy.denied') {
              logAgent('policy evaluation received', {
                type: ev.type,
                decision: ev.data?.decision,
                reasons: ev.data?.reasons
              });
              policyResolved = true;
            }
            if (ev.type === 'decision.finalized') {
              logAgent('decision finalized', { seq: ev.seq });
              policyResolved = true;
            }
          }
          if (!policyResolved) await new Promise((r) => setTimeout(r, 500));
        }

        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    logAgent('risk coordinator timed out', { participantId: context.participantId, proposalId });
  } finally {
    await cancelServer?.close();
    client.close();
  }
}

async function emitInitiatorEnvelopes(session: DecisionSession, bootstrap: ReturnType<typeof loadBootstrapPayload>): Promise<void> {
  const initiator = bootstrap.initiator!;
  const sessionStart = initiator.sessionStart;
  await session.start({
    intent: sessionStart.intent,
    participants: sessionStart.participants,
    ttlMs: sessionStart.ttlMs,
    context: sessionStart.context,
    roots: sessionStart.roots
  });
  logAgent('SessionStart emitted', { sessionId: bootstrap.run.sessionId });

  const kickoff = initiator.kickoff;
  if (!kickoff) return;

  if (kickoff.messageType === 'Proposal') {
    const payload = kickoff.payload;
    await session.propose({
      proposalId: String(payload.proposalId ?? payload.proposal_id ?? `${bootstrap.run.runId}-kickoff`),
      option: String(payload.option ?? 'decide'),
      rationale: payload.rationale !== undefined ? String(payload.rationale) : undefined
    });
    logAgent('kickoff proposal emitted', {});
  } else {
    logAgent('kickoff messageType not supported by initiator', { messageType: kickoff.messageType });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logAgent('risk coordinator failed', { error: message });
  process.exitCode = 1;
});
