#!/usr/bin/env python3
"""LangGraph fraud agent — evaluates proposals using a real LangGraph graph.

Uses macp_sdk.agent.Participant to read events from the runtime's gRPC
stream and emit responses directly. No control-plane polling.
"""

import json
import os
import sys
import logging

_HERE = os.path.dirname(__file__)
_SDK_SRC = os.path.join(_HERE, '..', '..', '..', 'python-sdk', 'src')
if os.path.isdir(_SDK_SRC) and _SDK_SRC not in sys.path:
    sys.path.insert(0, _SDK_SRC)

from macp_sdk.agent import from_bootstrap  # noqa: E402

from graph import build_graph  # noqa: E402
from mappers import map_kickoff_to_state  # noqa: E402

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
