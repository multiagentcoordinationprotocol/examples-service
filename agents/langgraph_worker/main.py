#!/usr/bin/env python3
"""LangGraph fraud agent — evaluates proposals using a real LangGraph graph.

Uses macp_sdk.agent.Participant to read events from the runtime's gRPC
stream and emit responses directly. No control-plane polling.
"""

import json
import os
import logging

from macp_sdk.agent import from_bootstrap

from graph import build_graph
from mappers import map_kickoff_to_state

logger = logging.getLogger("macp.agent")


def _load_session_context() -> dict:
    path = os.environ.get("MACP_BOOTSTRAP_FILE", "")
    if not path:
        return {}
    with open(path) as f:
        data = json.load(f)
    return (data.get("metadata") or {}).get("session_context") or {}


def main() -> int:
    participant = from_bootstrap()
    graph = build_graph()
    session_context = _load_session_context()

    def handle_proposal(message, ctx):
        graph_input = map_kickoff_to_state(session_context)
        graph_output = graph.invoke(graph_input)

        logger.info(
            "graph execution complete recommendation=%s confidence=%s",
            graph_output.get("recommendation"),
            graph_output.get("confidence"),
        )

        ctx.actions.evaluate(
            message.proposal_id or "",
            graph_output.get("recommendation", "REVIEW"),
            confidence=graph_output.get("confidence", 0.5),
            reason=graph_output.get("reason", "fraud graph evaluation"),
        )
        participant.stop()

    participant.on("Proposal", handle_proposal)
    participant.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
