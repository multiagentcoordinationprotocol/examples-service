import {
  ControlPlaneAgentClient,
  buildProtoEnvelope,
  extractDecodedPayload,
  extractMessageType,
  extractProposalId,
  extractSender,
  loadAgentRuntimeContext,
  logAgent
} from './control-plane-agent-client';
import { createPolicyStrategy, SpecialistSignal } from './policy-strategy';

async function main(): Promise<void> {
  const client = new ControlPlaneAgentClient();
  const context = loadAgentRuntimeContext();
  const strategy = createPolicyStrategy(context.policyHints);
  const deadline = Date.now() + Math.min(Math.max(context.ttlMs + 15000, 60000), 420000);
  const recipients = context.participants.filter((p) => p !== context.participantId);

  let afterSeq = 0;
  let proposalId: string | undefined;
  let committed = false;
  const signals = new Map<string, SpecialistSignal>();

  logAgent('risk coordinator started', {
    participantId: context.participantId,
    scenarioRef: context.scenarioRef,
    policyType: context.policyHints?.type ?? 'none',
    policyVersion: context.policyVersion ?? ''
  });

  while (Date.now() < deadline) {
    const run = await client.getRun(context.runId);
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      logAgent('run reached terminal status; exiting coordinator', { status: run.status });
      return;
    }

    const events = await client.getEvents(context.runId, afterSeq, 200);
    for (const event of events) {
      afterSeq = Math.max(afterSeq, event.seq);

      if (event.type === 'decision.finalized') {
        logAgent('decision already finalized; exiting coordinator', { seq: event.seq });
        return;
      }

      if (event.type === 'proposal.created' && !proposalId) {
        proposalId = extractProposalId(event);
        if (proposalId) {
          logAgent('proposal observed', { proposalId, seq: event.seq });
        }
        continue;
      }

      if (event.type !== 'proposal.updated' || !proposalId) continue;

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

      await client.sendMessage(context.runId, {
        from: context.participantId,
        to: recipients,
        messageType: 'Vote',
        payloadEnvelope: buildProtoEnvelope('macp.modes.decision.v1.VotePayload', {
          proposal_id: proposalId,
          vote: decision.vote,
          reason: decision.reason
        }),
        metadata: { framework: context.framework, agentRef: context.agentRef, hostKind: 'node-process' }
      });

      await new Promise((resolve) => setTimeout(resolve, 250));

      await client.sendMessage(context.runId, {
        from: context.participantId,
        to: recipients,
        messageType: 'Commitment',
        payloadEnvelope: buildProtoEnvelope('macp.v1.CommitmentPayload', {
          commitment_id: `${proposalId}-final`,
          action: decision.action,
          authority_scope: 'transaction_review',
          reason: decision.reason,
          mode_version: context.modeVersion,
          policy_version: context.policyVersion ?? '',
          configuration_version: context.configurationVersion,
          designated_roles: context.policyHints?.designatedRoles ?? [],
          veto_threshold: context.policyHints?.vetoThreshold ?? 1,
          minimum_confidence: context.policyHints?.minimumConfidence ?? 0.0
        }),
        metadata: { framework: context.framework, agentRef: context.agentRef, hostKind: 'node-process' }
      });

      logAgent('commitment sent', { proposalId, action: decision.action });
      await new Promise((resolve) => setTimeout(resolve, 750));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  logAgent('risk coordinator timed out', { participantId: context.participantId, proposalId });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logAgent('risk coordinator failed', { error: message });
  process.exitCode = 1;
});
