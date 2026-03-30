#!/usr/bin/env python3
"""CrewAI compliance agent worker — runs a real crew and emits MACP messages."""

import sys
import os
import time

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from macp_worker_sdk.bootstrap import load_bootstrap, log_agent
from macp_worker_sdk.client import ControlPlaneClient
from macp_worker_sdk.message_builder import extract_proposal_id

from crew import build_crew
from mappers import map_kickoff_to_crew_inputs, map_crew_result_to_macp_messages


def main() -> int:
    ctx = load_bootstrap()
    client = ControlPlaneClient(ctx)

    after_seq = 0
    responded = False
    deadline = time.time() + min(max((ctx.execution.ttl_ms / 1000.0) + 15.0, 60.0), 420.0)

    log_agent(
        'crewai compliance agent started',
        participantId=ctx.participant_id,
        runId=ctx.run_id,
        framework=ctx.framework,
    )

    while time.time() < deadline:
        run = client.get_run()
        if client.is_terminal(run):
            log_agent('run reached terminal status; exiting', status=run.get('status'))
            return 0

        for event in client.get_events(after_seq, 200):
            after_seq = max(after_seq, int(event.get('seq', 0) or 0))
            if event.get('type') != 'proposal.created' or responded:
                continue

            proposal_id = extract_proposal_id(event)
            if not proposal_id:
                continue

            log_agent('proposal observed, running crew', proposalId=proposal_id)

            crew_inputs = map_kickoff_to_crew_inputs(ctx.session_context)
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

            messages = map_crew_result_to_macp_messages(
                crew_output=crew_output,
                proposal_id=proposal_id,
                participant_id=ctx.participant_id,
                recipients=ctx.specialist_recipients(),
                framework=ctx.framework,
                agent_ref=ctx.participant.agent_id,
            )

            for msg in messages:
                client.send_message(msg)
                log_agent(
                    'compliance response sent',
                    proposalId=proposal_id,
                    messageType=msg.get('messageType'),
                )

            responded = True
            return 0

        time.sleep(0.75)

    log_agent('compliance agent timed out without a proposal')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
