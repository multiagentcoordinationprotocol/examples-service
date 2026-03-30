"""LangChain growth analysis chain.

When langchain is installed, this builds a real chain with LCEL.
Otherwise, falls back to a simple callable preserving the same contract.
"""

from typing import Any, Dict

JsonDict = Dict[str, Any]

try:
    from langchain_core.runnables import RunnableLambda

    def _analyze_growth(inputs: JsonDict) -> JsonDict:
        """Core growth analysis logic."""
        amount = float(inputs.get('transaction_amount', 0.0))
        vip = bool(inputs.get('is_vip_customer', False))
        account_age_days = int(inputs.get('account_age_days', 0))

        if vip and account_age_days >= 7 and amount <= 5000:
            return {
                'recommendation': 'APPROVE',
                'confidence': 0.88,
                'reason': 'customer value is high and the purchase fits a trusted profile',
                'factors': ['vip_status', 'account_maturity', 'amount_within_threshold'],
            }
        if amount > 5000 or account_age_days < 3:
            return {
                'recommendation': 'REVIEW',
                'confidence': 0.73,
                'reason': 'experience goals favor a step-up rather than an outright block',
                'factors': ['high_amount' if amount > 5000 else 'new_account'],
            }
        return {
            'recommendation': 'APPROVE',
            'confidence': 0.78,
            'reason': 'growth impact is favorable with manageable customer friction',
            'factors': ['standard_profile'],
        }

    def build_agent():
        """Build a LangChain runnable chain for growth analysis."""
        return RunnableLambda(_analyze_growth)

    HAS_LANGCHAIN = True

except ImportError:

    HAS_LANGCHAIN = False

    def build_agent():
        """Fallback: returns a callable that mimics chain.invoke()."""

        class FallbackChain:
            def invoke(self, inputs: JsonDict) -> JsonDict:
                amount = float(inputs.get('transaction_amount', 0.0))
                vip = bool(inputs.get('is_vip_customer', False))
                account_age_days = int(inputs.get('account_age_days', 0))

                if vip and account_age_days >= 7 and amount <= 5000:
                    return {
                        'recommendation': 'APPROVE',
                        'confidence': 0.88,
                        'reason': 'customer value is high and the purchase fits a trusted profile',
                        'factors': ['vip_status', 'account_maturity', 'amount_within_threshold'],
                    }
                if amount > 5000 or account_age_days < 3:
                    return {
                        'recommendation': 'REVIEW',
                        'confidence': 0.73,
                        'reason': 'experience goals favor a step-up rather than an outright block',
                        'factors': ['high_amount' if amount > 5000 else 'new_account'],
                    }
                return {
                    'recommendation': 'APPROVE',
                    'confidence': 0.78,
                    'reason': 'growth impact is favorable with manageable customer friction',
                    'factors': ['standard_profile'],
                }

        return FallbackChain()
