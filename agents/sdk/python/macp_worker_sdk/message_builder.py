"""MACP message builder and envelope validator."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

JsonDict = Dict[str, Any]


@dataclass
class MacpEnvelope:
    """Validated MACP message envelope."""
    run_id: str
    participant_id: str
    message_type: str
    payload: JsonDict = field(default_factory=dict)
    metadata: JsonDict = field(default_factory=dict)

    def to_dict(self) -> JsonDict:
        result: JsonDict = {
            'runId': self.run_id,
            'participantId': self.participant_id,
            'messageType': self.message_type,
            'payload': self.payload,
        }
        if self.metadata:
            result['metadata'] = self.metadata
        return result


class MacpMessageBuilder:
    """Builder for MACP-compliant messages from framework outputs."""

    def __init__(self, run_id: str, participant_id: str, framework: str, agent_ref: str) -> None:
        self.run_id = run_id
        self.participant_id = participant_id
        self.framework = framework
        self.agent_ref = agent_ref

    def build_proto_envelope(self, type_name: str, value: JsonDict) -> JsonDict:
        """Build a proto-encoded payload envelope."""
        return {
            'encoding': 'proto',
            'proto': {
                'typeName': type_name,
                'value': value,
            },
        }

    def evaluation(
        self,
        proposal_id: str,
        recommendation: str,
        confidence: float,
        reason: str,
        recipients: Optional[List[str]] = None,
    ) -> JsonDict:
        """Build an Evaluation message."""
        return self._build_message(
            message_type='Evaluation',
            recipients=recipients or [],
            payload_envelope=self.build_proto_envelope(
                'macp.modes.decision.v1.EvaluationPayload',
                {
                    'proposal_id': proposal_id,
                    'recommendation': recommendation,
                    'confidence': confidence,
                    'reason': reason,
                },
            ),
        )

    def objection(
        self,
        proposal_id: str,
        reason: str,
        severity: str = 'high',
        recipients: Optional[List[str]] = None,
    ) -> JsonDict:
        """Build an Objection message."""
        return self._build_message(
            message_type='Objection',
            recipients=recipients or [],
            payload_envelope=self.build_proto_envelope(
                'macp.modes.decision.v1.ObjectionPayload',
                {
                    'proposal_id': proposal_id,
                    'reason': reason,
                    'severity': severity,
                },
            ),
        )

    def vote(
        self,
        proposal_id: str,
        vote: str,
        reason: str,
        recipients: Optional[List[str]] = None,
    ) -> JsonDict:
        """Build a Vote message."""
        return self._build_message(
            message_type='Vote',
            recipients=recipients or [],
            payload_envelope=self.build_proto_envelope(
                'macp.modes.decision.v1.VotePayload',
                {
                    'proposal_id': proposal_id,
                    'vote': vote,
                    'reason': reason,
                },
            ),
        )

    def commitment(
        self,
        proposal_id: str,
        action: str,
        reason: str,
        authority_scope: str = 'transaction_review',
        mode_version: str = '',
        policy_version: str = '',
        configuration_version: str = '',
        recipients: Optional[List[str]] = None,
    ) -> JsonDict:
        """Build a Commitment message."""
        return self._build_message(
            message_type='Commitment',
            recipients=recipients or [],
            payload_envelope=self.build_proto_envelope(
                'macp.v1.CommitmentPayload',
                {
                    'commitment_id': f'{proposal_id}-final',
                    'action': action,
                    'authority_scope': authority_scope,
                    'reason': reason,
                    'mode_version': mode_version,
                    'policy_version': policy_version,
                    'configuration_version': configuration_version,
                },
            ),
        )

    def _build_message(
        self,
        message_type: str,
        recipients: List[str],
        payload_envelope: JsonDict,
    ) -> JsonDict:
        return {
            'from': self.participant_id,
            'to': recipients,
            'messageType': message_type,
            'payloadEnvelope': payload_envelope,
            'metadata': {
                'framework': self.framework,
                'agentRef': self.agent_ref,
                'hostKind': f'{self.framework}-process',
            },
        }


def extract_payload(event: JsonDict) -> JsonDict:
    """Extract the decoded payload from a control plane event."""
    data = event.get('data') or {}
    payload = data.get('decodedPayload') or data.get('payload') or {}
    return payload if isinstance(payload, dict) else {}


def extract_proposal_id(event: JsonDict) -> Optional[str]:
    """Extract proposal_id from an event."""
    payload = extract_payload(event)
    proposal_id = payload.get('proposalId') or payload.get('proposal_id')
    if isinstance(proposal_id, str):
        return proposal_id
    subject = event.get('subject') or {}
    subject_id = subject.get('id') if isinstance(subject, dict) else None
    return subject_id if isinstance(subject_id, str) else None


def extract_sender(event: JsonDict) -> Optional[str]:
    """Extract sender from an event."""
    data = event.get('data') or {}
    sender = data.get('sender')
    return sender if isinstance(sender, str) else None


def extract_message_type(event: JsonDict) -> Optional[str]:
    """Extract messageType from an event."""
    data = event.get('data') or {}
    message_type = data.get('messageType')
    return message_type if isinstance(message_type, str) else None
