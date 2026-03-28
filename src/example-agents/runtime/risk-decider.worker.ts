import {
  AgentRuntimeContext,
  buildProtoEnvelope,
  ControlPlaneAgentClient,
  extractDecodedPayload,
  extractMessageType,
  extractProposalId,
  extractSender,
  loadAgentRuntimeContext,
  logAgent
} from './control-plane-agent-client';

type SpecialistResponse = {
  messageType: 'Evaluation' | 'Objection';
  payload: Record<string, unknown>;
};

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function decisionFromResponses(
  context: AgentRuntimeContext,
  responses: Map<string, SpecialistResponse>
): { action: 'approve' | 'step_up' | 'decline'; reason: string } {
  const trust = toNumber(context.sessionContext.deviceTrustScore) ?? 0;
  const chargebacks = toNumber(context.sessionContext.priorChargebacks) ?? 0;
  const vip = toBoolean(context.sessionContext.isVipCustomer) ?? false;

  let hasBlockingSignal = false;
  let hasReviewSignal = false;

  for (const response of responses.values()) {
    if (response.messageType === 'Objection') {
      const severity = String(response.payload.severity ?? '').toLowerCase();
      if (['high', 'critical'].includes(severity)) {
        hasBlockingSignal = true;
      } else {
        hasReviewSignal = true;
      }
      continue;
    }

    const recommendation = String(response.payload.recommendation ?? '').toUpperCase();
    if (['BLOCK', 'REJECT'].includes(recommendation)) {
      hasBlockingSignal = true;
    } else if (recommendation === 'REVIEW') {
      hasReviewSignal = true;
    }
  }

  if (trust < 0.08 || chargebacks >= 2) {
    hasBlockingSignal = true;
  } else if (trust < 0.18) {
    hasReviewSignal = true;
  }

  if (hasBlockingSignal) {
    return {
      action: 'decline',
      reason: 'coordinator observed blocking specialist signals for the proposed transaction'
    };
  }

  if (hasReviewSignal || !vip) {
    return {
      action: 'step_up',
      reason: 'coordinator requires additional verification before approval'
    };
  }

  return {
    action: 'approve',
    reason: 'specialist agents converged on an approval with acceptable risk'
  };
}

async function main(): Promise<void> {
  const client = new ControlPlaneAgentClient();
  const context = loadAgentRuntimeContext();
  const deadline = Date.now() + Math.min(Math.max(context.ttlMs + 15000, 60000), 420000);
  const recipients = context.participants.filter((participant) => participant !== context.participantId);
  const specialistIds = recipients;

  let afterSeq = 0;
  let proposalId: string | undefined;
  let proposalSeenAt = 0;
  let voteSent = false;
  const specialistResponses = new Map<string, SpecialistResponse>();

  logAgent('risk agent worker started', {
    participantId: context.participantId,
    scenarioRef: context.scenarioRef,
    framework: context.framework
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
        proposalSeenAt = Date.now();
        if (proposalId) {
          logAgent('proposal observed', { proposalId, seq: event.seq });
        }
        continue;
      }

      if (event.type !== 'proposal.updated' || !proposalId) {
        continue;
      }

      const eventProposalId = extractProposalId(event);
      if (!eventProposalId || eventProposalId !== proposalId) {
        continue;
      }

      const sender = extractSender(event);
      const messageType = extractMessageType(event);
      if (!sender || sender === context.participantId || !messageType) {
        continue;
      }

      if (messageType !== 'Evaluation' && messageType !== 'Objection') {
        continue;
      }

      specialistResponses.set(sender, {
        messageType,
        payload: extractDecodedPayload(event)
      });
    }

    const readyToFinalize =
      !!proposalId &&
      !voteSent &&
      specialistResponses.size > 0 &&
      (specialistResponses.size >= specialistIds.length || Date.now() - proposalSeenAt > 15000);

    if (readyToFinalize && proposalId) {
      const finalDecision = decisionFromResponses(context, specialistResponses);
      const vote = finalDecision.action === 'decline' ? 'reject' : 'approve';

      logAgent('sending vote', {
        proposalId,
        vote,
        action: finalDecision.action,
        specialistResponses: specialistResponses.size
      });

      await client.sendMessage(context.runId, {
        from: context.participantId,
        to: recipients,
        messageType: 'Vote',
        payloadEnvelope: buildProtoEnvelope('macp.modes.decision.v1.VotePayload', {
          proposal_id: proposalId,
          vote,
          reason: finalDecision.reason
        }),
        metadata: {
          framework: context.framework,
          agentRef: context.agentRef,
          hostKind: 'node-process'
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 250));

      await client.sendMessage(context.runId, {
        from: context.participantId,
        to: recipients,
        messageType: 'Commitment',
        payloadEnvelope: buildProtoEnvelope('macp.v1.CommitmentPayload', {
          commitment_id: `${proposalId}-final`,
          action: finalDecision.action,
          authority_scope: 'transaction_review',
          reason: finalDecision.reason,
          mode_version: context.modeVersion,
          policy_version: context.policyVersion ?? '',
          configuration_version: context.configurationVersion
        }),
        metadata: {
          framework: context.framework,
          agentRef: context.agentRef,
          hostKind: 'node-process'
        }
      });

      logAgent('commitment sent', {
        proposalId,
        action: finalDecision.action
      });
      voteSent = true;
      await new Promise((resolve) => setTimeout(resolve, 750));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  logAgent('risk agent worker timed out before finalization', {
    participantId: context.participantId,
    proposalId
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logAgent('risk agent worker failed', { error: message });
  process.exitCode = 1;
});
