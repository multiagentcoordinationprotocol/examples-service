"""Input/output mappers between MACP kickoff and LangGraph state."""

from typing import Any, Dict, List

JsonDict = Dict[str, Any]


def map_kickoff_to_state(session_context: JsonDict) -> JsonDict:
    """Convert MACP session context into LangGraph input state."""
    return {
        'device_trust_score': float(session_context.get('deviceTrustScore', 0.0) or 0.0),
        'prior_chargebacks': int(session_context.get('priorChargebacks', 0) or 0),
        'transaction_amount': float(session_context.get('transactionAmount', 0.0) or 0.0),
        'account_age_days': int(session_context.get('accountAgeDays', 0) or 0),
        'is_vip_customer': bool(session_context.get('isVipCustomer', False)),
        'recommendation': '',
        'confidence': 0.0,
        'reason': '',
        'signals': [],
    }


def map_state_to_macp_messages(
    graph_output: JsonDict,
    proposal_id: str,
    participant_id: str,
    recipients: List[str],
    framework: str,
    agent_ref: str,
) -> List[JsonDict]:
    """Convert LangGraph terminal state into MACP Evaluation messages."""
    recommendation = str(graph_output.get('recommendation', 'REVIEW'))
    confidence = float(graph_output.get('confidence', 0.5))
    reason = str(graph_output.get('reason', ''))

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
                'hostKind': 'langgraph-process',
                'signals': graph_output.get('signals', []),
            },
        }
    ]
