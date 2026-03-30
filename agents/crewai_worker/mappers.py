"""Input/output mappers between MACP kickoff and CrewAI crew I/O."""

from typing import Any, Dict, List

JsonDict = Dict[str, Any]


def map_kickoff_to_crew_inputs(session_context: JsonDict) -> JsonDict:
    """Convert MACP session context into CrewAI crew input."""
    return {
        'device_trust_score': float(session_context.get('deviceTrustScore', 0.0) or 0.0),
        'transaction_amount': float(session_context.get('transactionAmount', 0.0) or 0.0),
        'account_age_days': int(session_context.get('accountAgeDays', 0) or 0),
        'prior_chargebacks': int(session_context.get('priorChargebacks', 0) or 0),
        'is_vip_customer': bool(session_context.get('isVipCustomer', False)),
    }


def map_crew_result_to_macp_messages(
    crew_output: JsonDict,
    proposal_id: str,
    participant_id: str,
    recipients: List[str],
    framework: str,
    agent_ref: str,
) -> List[JsonDict]:
    """Convert CrewAI crew result into MACP messages (Evaluation or Objection)."""
    # CrewAI output may be a string or a dict
    if isinstance(crew_output, str):
        crew_output = {
            'message_type': 'Evaluation',
            'recommendation': 'REVIEW',
            'confidence': 0.5,
            'reason': crew_output,
        }

    message_type = crew_output.get('message_type', 'Evaluation')

    if message_type == 'Objection':
        return [
            {
                'from': participant_id,
                'to': recipients,
                'messageType': 'Objection',
                'payloadEnvelope': {
                    'encoding': 'proto',
                    'proto': {
                        'typeName': 'macp.modes.decision.v1.ObjectionPayload',
                        'value': {
                            'proposal_id': proposal_id,
                            'reason': str(crew_output.get('reason', '')),
                            'severity': str(crew_output.get('severity', 'high')),
                        },
                    },
                },
                'metadata': {
                    'framework': framework,
                    'agentRef': agent_ref,
                    'hostKind': 'crewai-process',
                },
            }
        ]

    return [
        {
            'from': participant_id,
            'to': recipients,
            'messageType': 'Evaluation',
            'payloadEnvelope': {
                'encoding': 'proto',
                'proto': {
                    'typeName': 'macp.modes.decision.v1.EvaluationPayload',
                    'value': {
                        'proposal_id': proposal_id,
                        'recommendation': str(crew_output.get('recommendation', 'REVIEW')),
                        'confidence': float(crew_output.get('confidence', 0.76)),
                        'reason': str(crew_output.get('reason', '')),
                    },
                },
            },
            'metadata': {
                'framework': framework,
                'agentRef': agent_ref,
                'hostKind': 'crewai-process',
            },
        }
    ]
