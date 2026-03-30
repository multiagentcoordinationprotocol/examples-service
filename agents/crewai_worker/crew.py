"""CrewAI compliance review crew.

When crewai is installed, this builds a real Crew with Agent and Task.
Otherwise, falls back to a simple callable preserving the same contract.
"""

from typing import Any, Dict

JsonDict = Dict[str, Any]

try:
    from crewai import Agent, Task, Crew

    def build_crew(inputs: JsonDict):
        """Build a CrewAI crew for compliance review."""
        compliance_analyst = Agent(
            role='Compliance Analyst',
            goal='Review transactions for policy and regulatory compliance',
            backstory=(
                'You are a compliance analyst reviewing transactions for KYC/AML and '
                'policy adherence. You flag issues with severity ratings.'
            ),
            verbose=False,
            allow_delegation=False,
        )

        review_task = Task(
            description=(
                f"Review the following transaction for compliance:\n"
                f"- Device trust score: {inputs.get('device_trust_score', 'unknown')}\n"
                f"- Transaction amount: {inputs.get('transaction_amount', 'unknown')}\n"
                f"- Account age (days): {inputs.get('account_age_days', 'unknown')}\n"
                f"- Prior chargebacks: {inputs.get('prior_chargebacks', 'unknown')}\n"
                f"Provide a compliance assessment with severity rating."
            ),
            expected_output='JSON with message_type (Evaluation or Objection), severity, reason, and recommendation',
            agent=compliance_analyst,
        )

        crew = Crew(
            agents=[compliance_analyst],
            tasks=[review_task],
            verbose=False,
        )

        return crew

    HAS_CREWAI = True

except ImportError:

    HAS_CREWAI = False

    def build_crew(inputs: JsonDict):
        """Fallback: returns a callable that mimics crew.kickoff()."""

        class FallbackCrew:
            def kickoff(self) -> JsonDict:
                trust = float(inputs.get('device_trust_score', 0.0))
                amount = float(inputs.get('transaction_amount', 0.0))
                account_age_days = int(inputs.get('account_age_days', 0))
                chargebacks = int(inputs.get('prior_chargebacks', 0))

                if trust <= 0.08 or chargebacks >= 2 or (amount >= 3000 and account_age_days < 7):
                    return {
                        'message_type': 'Objection',
                        'severity': 'high',
                        'reason': 'policy checks require additional verification before approval',
                        'recommendation': 'BLOCK',
                    }

                return {
                    'message_type': 'Evaluation',
                    'severity': 'low',
                    'reason': 'compliance checks pass with a step-up recommendation for documentation hygiene',
                    'recommendation': 'REVIEW',
                    'confidence': 0.76,
                }

        return FallbackCrew()
