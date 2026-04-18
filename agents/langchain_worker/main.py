#!/usr/bin/env python3
"""LangChain growth agent — evaluates proposals using a real LangChain chain.

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

from chain import build_agent  # noqa: E402
from mappers import map_kickoff_to_inputs  # noqa: E402

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
    chain = build_agent()
    session_context = _load_session_context()

    def handle_proposal(message, ctx):
        chain_input = map_kickoff_to_inputs(session_context)
        chain_output = chain.invoke(chain_input)

        logger.info(
            "chain execution complete recommendation=%s confidence=%s",
            chain_output.get("recommendation"),
            chain_output.get("confidence"),
        )

        ctx.actions.evaluate(
            message.proposal_id or "",
            chain_output.get("recommendation", "REVIEW"),
            confidence=chain_output.get("confidence", 0.5),
            reason=chain_output.get("reason", "growth chain evaluation"),
        )
        participant.stop()

    participant.on("Proposal", handle_proposal)
    participant.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
