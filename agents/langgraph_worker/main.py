#!/usr/bin/env python3
"""LangGraph fraud agent worker — runs a real graph and emits MACP messages."""

import sys
import os
import time

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from macp_worker_sdk.bootstrap import load_bootstrap, log_agent
from macp_worker_sdk.client import ControlPlaneClient
from macp_worker_sdk.message_builder import extract_proposal_id

from graph import build_graph
from mappers import map_kickoff_to_state, map_state_to_macp_messages


def main() -> int:
    ctx = load_bootstrap()
    client = ControlPlaneClient(ctx)
    graph = build_graph()

    after_seq = 0
    responded = False
    deadline = time.time() + min(max((ctx.execution.ttl_ms / 1000.0) + 15.0, 60.0), 420.0)

    log_agent(
        'langgraph fraud agent started',
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

            log_agent('proposal observed, running graph', proposalId=proposal_id)

            graph_input = map_kickoff_to_state(ctx.session_context)
            graph_output = graph.invoke(graph_input)

            log_agent(
                'graph execution complete',
                recommendation=graph_output.get('recommendation'),
                confidence=graph_output.get('confidence'),
                signals=graph_output.get('signals', []),
            )

            messages = map_state_to_macp_messages(
                graph_output=graph_output,
                proposal_id=proposal_id,
                participant_id=ctx.participant_id,
                recipients=ctx.specialist_recipients(),
                framework=ctx.framework,
                agent_ref=ctx.participant.agent_id,
            )

            for msg in messages:
                client.send_message(msg)
                log_agent(
                    'evaluation sent',
                    proposalId=proposal_id,
                    recommendation=graph_output.get('recommendation'),
                )

            responded = True
            return 0

        time.sleep(0.75)

    log_agent('fraud agent timed out without a proposal')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
