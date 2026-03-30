"""LangGraph fraud detection graph.

When langgraph is installed, this builds a real StateGraph.
Otherwise, falls back to a simple function-based graph that
preserves the same input/output contract.
"""

from typing import Any, Dict, List, TypedDict

JsonDict = Dict[str, Any]

try:
    from langgraph.graph import StateGraph, END

    class FraudState(TypedDict):
        device_trust_score: float
        prior_chargebacks: int
        transaction_amount: float
        account_age_days: int
        is_vip_customer: bool
        recommendation: str
        confidence: float
        reason: str
        signals: List[str]

    def evaluate_device_trust(state: FraudState) -> dict:
        signals = list(state.get('signals', []))
        trust = state['device_trust_score']
        if trust < 0.08:
            signals.append('critical_device_trust')
        elif trust < 0.2:
            signals.append('low_device_trust')
        return {'signals': signals}

    def evaluate_chargeback_history(state: FraudState) -> dict:
        signals = list(state.get('signals', []))
        chargebacks = state['prior_chargebacks']
        if chargebacks >= 2:
            signals.append('high_chargeback_risk')
        elif chargebacks >= 1:
            signals.append('moderate_chargeback_risk')
        return {'signals': signals}

    def make_recommendation(state: FraudState) -> dict:
        signals = state.get('signals', [])
        if 'critical_device_trust' in signals or 'high_chargeback_risk' in signals:
            return {
                'recommendation': 'BLOCK',
                'confidence': 0.94,
                'reason': 'device trust is critically low for this account history',
            }
        if 'low_device_trust' in signals or 'moderate_chargeback_risk' in signals:
            return {
                'recommendation': 'REVIEW',
                'confidence': 0.84,
                'reason': 'device trust or chargeback history requires manual review',
            }
        return {
            'recommendation': 'APPROVE',
            'confidence': 0.72,
            'reason': 'fraud signals are within the acceptable range for this session',
        }

    def build_graph() -> StateGraph:
        """Build the LangGraph fraud evaluation graph."""
        graph = StateGraph(FraudState)
        graph.add_node('evaluate_device_trust', evaluate_device_trust)
        graph.add_node('evaluate_chargeback_history', evaluate_chargeback_history)
        graph.add_node('make_recommendation', make_recommendation)
        graph.set_entry_point('evaluate_device_trust')
        graph.add_edge('evaluate_device_trust', 'evaluate_chargeback_history')
        graph.add_edge('evaluate_chargeback_history', 'make_recommendation')
        graph.add_edge('make_recommendation', END)
        return graph.compile()

    HAS_LANGGRAPH = True

except ImportError:

    HAS_LANGGRAPH = False

    def build_graph():
        """Fallback: returns a callable that mimics graph.invoke()."""

        class FallbackGraph:
            def invoke(self, state: JsonDict) -> JsonDict:
                trust = float(state.get('device_trust_score', 0.0))
                chargebacks = int(state.get('prior_chargebacks', 0))
                signals: List[str] = []

                if trust < 0.08:
                    signals.append('critical_device_trust')
                elif trust < 0.2:
                    signals.append('low_device_trust')

                if chargebacks >= 2:
                    signals.append('high_chargeback_risk')
                elif chargebacks >= 1:
                    signals.append('moderate_chargeback_risk')

                if 'critical_device_trust' in signals or 'high_chargeback_risk' in signals:
                    return {
                        **state,
                        'signals': signals,
                        'recommendation': 'BLOCK',
                        'confidence': 0.94,
                        'reason': 'device trust is critically low for this account history',
                    }
                if 'low_device_trust' in signals or 'moderate_chargeback_risk' in signals:
                    return {
                        **state,
                        'signals': signals,
                        'recommendation': 'REVIEW',
                        'confidence': 0.84,
                        'reason': 'device trust or chargeback history requires manual review',
                    }
                return {
                    **state,
                    'signals': signals,
                    'recommendation': 'APPROVE',
                    'confidence': 0.72,
                    'reason': 'fraud signals are within the acceptable range for this session',
                }

        return FallbackGraph()
