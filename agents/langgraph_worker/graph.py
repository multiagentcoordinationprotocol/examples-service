"""LangGraph fraud detection graph.

When langgraph and langchain-openai are installed, this builds a real StateGraph
with an LLM-powered recommendation node. Otherwise, falls back to deterministic logic.
"""

import json
import os
from typing import Any, Dict, List, TypedDict

JsonDict = Dict[str, Any]

try:
    from langgraph.graph import StateGraph, END
    from langchain_openai import ChatOpenAI

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
        token_usage: dict

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

    def llm_recommendation(state: FraudState) -> dict:
        """Use gpt-4o-mini to make a fraud recommendation based on signals."""
        api_key = os.environ.get('OPENAI_API_KEY', '')
        if not api_key:
            # No API key — fall back to deterministic logic
            return _deterministic_recommendation(state)

        llm = ChatOpenAI(model='gpt-4o-mini', temperature=0, api_key=api_key)
        signals = state.get('signals', [])

        prompt = (
            f"You are a fraud detection analyst. Based on the following signals and transaction data, "
            f"provide a fraud assessment.\n\n"
            f"Signals detected: {', '.join(signals) if signals else 'none'}\n"
            f"Device trust score: {state.get('device_trust_score', 'unknown')}\n"
            f"Prior chargebacks: {state.get('prior_chargebacks', 0)}\n"
            f"Transaction amount: ${state.get('transaction_amount', 0)}\n"
            f"Account age: {state.get('account_age_days', 0)} days\n"
            f"VIP customer: {state.get('is_vip_customer', False)}\n\n"
            f"Respond with ONLY a JSON object (no markdown): "
            f'{{"recommendation": "APPROVE"|"REVIEW"|"BLOCK", "confidence": 0.0-1.0, "reason": "brief explanation"}}'
        )

        response = llm.invoke(prompt)

        # Extract token usage
        usage = response.usage_metadata or {}
        token_usage = {
            'promptTokens': usage.get('input_tokens', 0),
            'completionTokens': usage.get('output_tokens', 0),
            'model': 'gpt-4o-mini',
        }

        # Parse the LLM response
        try:
            content = response.content.strip()
            if content.startswith('```'):
                content = content.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            parsed = json.loads(content)
            return {
                'recommendation': parsed.get('recommendation', 'REVIEW').upper(),
                'confidence': float(parsed.get('confidence', 0.8)),
                'reason': parsed.get('reason', 'LLM-based fraud assessment'),
                'token_usage': token_usage,
            }
        except (json.JSONDecodeError, ValueError):
            return {
                'recommendation': 'REVIEW',
                'confidence': 0.7,
                'reason': str(response.content)[:200],
                'token_usage': token_usage,
            }

    def _deterministic_recommendation(state: FraudState) -> dict:
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
        """Build the LangGraph fraud evaluation graph with LLM recommendation."""
        graph = StateGraph(FraudState)
        graph.add_node('evaluate_device_trust', evaluate_device_trust)
        graph.add_node('evaluate_chargeback_history', evaluate_chargeback_history)
        graph.add_node('llm_recommendation', llm_recommendation)
        graph.set_entry_point('evaluate_device_trust')
        graph.add_edge('evaluate_device_trust', 'evaluate_chargeback_history')
        graph.add_edge('evaluate_chargeback_history', 'llm_recommendation')
        graph.add_edge('llm_recommendation', END)
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
