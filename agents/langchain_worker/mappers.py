"""Input/output mappers between MACP kickoff and LangChain chain I/O."""

from typing import Any, Dict, List

JsonDict = Dict[str, Any]


def map_kickoff_to_inputs(session_context: JsonDict) -> JsonDict:
    """Convert MACP session context into LangChain chain input."""
    return {
        'transaction_amount': float(session_context.get('transactionAmount', 0.0) or 0.0),
        'is_vip_customer': bool(session_context.get('isVipCustomer', False)),
        'account_age_days': int(session_context.get('accountAgeDays', 0) or 0),
        'device_trust_score': float(session_context.get('deviceTrustScore', 0.0) or 0.0),
        'prior_chargebacks': int(session_context.get('priorChargebacks', 0) or 0),
    }


def map_result_to_macp_messages(
    chain_output: JsonDict,
    proposal_id: str,
    participant_id: str,
    recipients: List[str],
    framework: str,
    agent_ref: str,
) -> List[JsonDict]:
    """Convert LangChain chain output into MACP Evaluation messages."""
    recommendation = str(chain_output.get('recommendation', 'REVIEW'))
    confidence = float(chain_output.get('confidence', 0.5))
    reason = str(chain_output.get('reason', ''))

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
                        'recommendation': recommendation,
                        'confidence': confidence,
                        'reason': reason,
                    },
                },
            },
            'metadata': {
                'framework': framework,
                'agentRef': agent_ref,
                'hostKind': 'langchain-process',
                'factors': chain_output.get('factors', []),
            },
        }
    ]
