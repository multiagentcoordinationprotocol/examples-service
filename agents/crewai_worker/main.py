#!/usr/bin/env python3
"""CrewAI compliance agent worker — runs a real crew and emits MACP messages.

Direct-agent-auth (RFC-MACP-0004 §4): this worker authenticates directly to
the MACP runtime over gRPC using a per-agent Bearer token loaded from its
bootstrap file. The control-plane is observed via read-only HTTP polling; it
NEVER forges envelopes on this agent's behalf.
"""

import sys
import os

_HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(_HERE, '..', 'sdk', 'python'))
_SDK_SRC = os.path.join(_HERE, '..', '..', '..', 'python-sdk', 'src')
if os.path.isdir(_SDK_SRC) and _SDK_SRC not in sys.path:
    sys.path.insert(0, _SDK_SRC)

from macp_worker_sdk.bootstrap import log_agent  # noqa: E402
from macp_worker_sdk.participant import from_bootstrap  # noqa: E402

from crew import build_crew  # noqa: E402
from mappers import map_kickoff_to_crew_inputs  # noqa: E402


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

        log_agent(
            'crew execution complete',
            messageType=crew_output.get('message_type'),
            recommendation=crew_output.get('recommendation'),
        )

        message_type = crew_output.get('message_type', 'Evaluation')

        if message_type == 'Objection':
            ctx.actions.object(
                proposal_id=ctx.proposal_id,
                reason=crew_output.get('reason', 'compliance concern'),
                severity=crew_output.get('severity', 'high'),
            )
        else:
            ctx.actions.evaluate(
                proposal_id=ctx.proposal_id,
                recommendation=crew_output.get('recommendation', 'REVIEW'),
                confidence=float(crew_output.get('confidence', 0.76)),
                reason=crew_output.get('reason', 'compliance crew evaluation'),
            )

        log_agent('compliance response sent', proposalId=ctx.proposal_id, messageType=message_type)
        participant.stop()

    participant.run()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
