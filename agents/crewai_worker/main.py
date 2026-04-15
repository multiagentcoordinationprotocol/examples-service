#!/usr/bin/env python3
"""CrewAI compliance agent worker — runs a real crew and emits MACP messages."""

import sys
import os

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from macp_worker_sdk.bootstrap import log_agent
from macp_worker_sdk.participant import from_bootstrap

from crew import build_crew
from mappers import map_kickoff_to_crew_inputs


def main() -> int:
    participant = from_bootstrap()

    @participant.on('Proposal')
    def handle_proposal(ctx):
        crew_inputs = map_kickoff_to_crew_inputs(ctx.bootstrap.session_context)
        crew = build_crew(crew_inputs)
        crew_result = crew.kickoff()

        # CrewAI may return a string or CrewOutput object
        if hasattr(crew_result, 'raw'):
            crew_output = {'message_type': 'Evaluation', 'reason': str(crew_result.raw)}
        elif isinstance(crew_result, dict):
            crew_output = crew_result
        elif isinstance(crew_result, str):
            crew_output = {'message_type': 'Evaluation', 'reason': crew_result}
        else:
            crew_output = {'message_type': 'Evaluation', 'reason': str(crew_result)}

        # Extract token usage from CrewAI if available
        token_usage = None
        if hasattr(crew, 'usage_metrics') and crew.usage_metrics:
            metrics = crew.usage_metrics
            token_usage = {
                'promptTokens': metrics.get('prompt_tokens', 0) or metrics.get('input_tokens', 0),
                'completionTokens': metrics.get('completion_tokens', 0) or metrics.get('output_tokens', 0),
                'model': 'gpt-4o-mini',
            }

        log_agent(
            'crew execution complete',
            messageType=crew_output.get('message_type'),
            recommendation=crew_output.get('recommendation'),
            tokens=token_usage.get('promptTokens', 0) + token_usage.get('completionTokens', 0) if token_usage else 0,
        )

        message_type = crew_output.get('message_type', 'Evaluation')

        if message_type == 'Objection':
            ctx.actions.object(
                proposal_id=ctx.proposal_id,
                reason=crew_output.get('reason', 'compliance concern'),
                severity=crew_output.get('severity', 'high'),
                token_usage=token_usage,
            )
        else:
            ctx.actions.evaluate(
                proposal_id=ctx.proposal_id,
                recommendation=crew_output.get('recommendation', 'REVIEW'),
                confidence=float(crew_output.get('confidence', 0.76)),
                reason=crew_output.get('reason', 'compliance crew evaluation'),
                token_usage=token_usage,
            )

        log_agent('compliance response sent', proposalId=ctx.proposal_id, messageType=message_type)
        participant.stop()

    participant.run()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
