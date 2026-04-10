#!/usr/bin/env python3
"""LangGraph fraud agent worker — runs a real graph and emits MACP messages."""

import sys
import os

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from macp_worker_sdk.bootstrap import log_agent
from macp_worker_sdk.participant import from_bootstrap

from graph import build_graph
from mappers import map_kickoff_to_state


def main() -> int:
    participant = from_bootstrap()
    graph = build_graph()

    @participant.on('Proposal')
    def handle_proposal(ctx):
        graph_input = map_kickoff_to_state(ctx.bootstrap.session_context)
        graph_output = graph.invoke(graph_input)

        log_agent(
            'graph execution complete',
            recommendation=graph_output.get('recommendation'),
            confidence=graph_output.get('confidence'),
            signals=graph_output.get('signals', []),
        )

        ctx.actions.evaluate(
            proposal_id=ctx.proposal_id,
            recommendation=graph_output.get('recommendation', 'REVIEW'),
            confidence=graph_output.get('confidence', 0.5),
            reason=graph_output.get('reason', 'fraud graph evaluation'),
        )

        log_agent('evaluation sent', proposalId=ctx.proposal_id)
        participant.stop()

    participant.run()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
