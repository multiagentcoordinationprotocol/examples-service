type JsonRecord = Record<string, unknown>;

export interface MacpEnvelope {
  runId: string;
  participantId: string;
  messageType: string;
  payload: JsonRecord;
  metadata?: JsonRecord;
}

export class MacpMessageBuilder {
  constructor(
    private readonly runId: string,
    private readonly participantId: string,
    private readonly framework: string,
    private readonly agentRef: string
  ) {}

  buildProtoEnvelope(typeName: string, value: JsonRecord): JsonRecord {
    return {
      encoding: 'proto',
      proto: { typeName, value }
    };
  }

  evaluation(
    proposalId: string,
    recommendation: string,
    confidence: number,
    reason: string,
    recipients: string[] = []
  ): JsonRecord {
    return this.buildMessage('Evaluation', recipients, this.buildProtoEnvelope(
      'macp.modes.decision.v1.EvaluationPayload',
      { proposal_id: proposalId, recommendation, confidence, reason }
    ));
  }

  objection(
    proposalId: string,
    reason: string,
    severity = 'high',
    recipients: string[] = []
  ): JsonRecord {
    return this.buildMessage('Objection', recipients, this.buildProtoEnvelope(
      'macp.modes.decision.v1.ObjectionPayload',
      { proposal_id: proposalId, reason, severity }
    ));
  }

  vote(proposalId: string, vote: string, reason: string, recipients: string[] = []): JsonRecord {
    return this.buildMessage('Vote', recipients, this.buildProtoEnvelope(
      'macp.modes.decision.v1.VotePayload',
      { proposal_id: proposalId, vote, reason }
    ));
  }

  commitment(
    proposalId: string,
    action: string,
    reason: string,
    options: {
      authorityScope?: string;
      modeVersion?: string;
      policyVersion?: string;
      configurationVersion?: string;
    } = {},
    recipients: string[] = []
  ): JsonRecord {
    return this.buildMessage('Commitment', recipients, this.buildProtoEnvelope(
      'macp.v1.CommitmentPayload',
      {
        commitment_id: `${proposalId}-final`,
        action,
        authority_scope: options.authorityScope ?? 'transaction_review',
        reason,
        mode_version: options.modeVersion ?? '',
        policy_version: options.policyVersion ?? '',
        configuration_version: options.configurationVersion ?? ''
      }
    ));
  }

  private buildMessage(
    messageType: string,
    recipients: string[],
    payloadEnvelope: JsonRecord
  ): JsonRecord {
    return {
      from: this.participantId,
      to: recipients,
      messageType,
      payloadEnvelope,
      metadata: {
        framework: this.framework,
        agentRef: this.agentRef,
        hostKind: `${this.framework}-process`
      }
    };
  }
}

export function extractPayload(event: JsonRecord): JsonRecord {
  const data = (event.data as JsonRecord) ?? {};
  const payload = (data.decodedPayload as JsonRecord) ?? (data.payload as JsonRecord) ?? {};
  return payload;
}

export function extractProposalId(event: JsonRecord): string | undefined {
  const payload = extractPayload(event);
  const proposalId = payload.proposalId ?? payload.proposal_id;
  if (typeof proposalId === 'string') return proposalId;
  const subject = event.subject as JsonRecord | undefined;
  const subjectId = subject?.id;
  return typeof subjectId === 'string' ? subjectId : undefined;
}

export function extractSender(event: JsonRecord): string | undefined {
  const data = (event.data as JsonRecord) ?? {};
  const sender = data.sender;
  return typeof sender === 'string' ? sender : undefined;
}

export function extractMessageType(event: JsonRecord): string | undefined {
  const data = (event.data as JsonRecord) ?? {};
  const messageType = data.messageType;
  return typeof messageType === 'string' ? messageType : undefined;
}
