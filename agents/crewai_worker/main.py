#!/usr/bin/env python3
"""CrewAI compliance agent — evaluates proposals using a real CrewAI crew.

Uses macp_sdk.agent.Participant to read events from the runtime's gRPC
stream and emit responses directly. No control-plane polling.
"""

import json
import os
import logging

from macp_sdk.agent import from_bootstrap

from crew import build_crew
from mappers import map_kickoff_to_crew_inputs

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
    session_context = _load_session_context()

    def handle_proposal(message, ctx):
        crew_inputs = map_kickoff_to_crew_inputs(session_context)
        crew = build_crew(crew_inputs)
        crew_result = crew.kickoff()

        if hasattr(crew_result, "raw"):
            crew_output = {"message_type": "Evaluation", "reason": str(crew_result.raw)}
        elif isinstance(crew_result, dict):
            crew_output = crew_result
        elif isinstance(crew_result, str):
            crew_output = {"message_type": "Evaluation", "reason": crew_result}
        else:
            crew_output = {"message_type": "Evaluation", "reason": str(crew_result)}

        logger.info(
            "crew execution complete messageType=%s recommendation=%s",
            crew_output.get("message_type"),
            crew_output.get("recommendation"),
        )

        proposal_id = message.proposal_id or ""

        if crew_output.get("message_type") == "Objection":
            ctx.actions.raise_objection(
                proposal_id,
                reason=crew_output.get("reason", "compliance concern"),
                severity=crew_output.get("severity", "high"),
            )
        else:
            ctx.actions.evaluate(
                proposal_id,
                crew_output.get("recommendation", "REVIEW"),
                confidence=float(crew_output.get("confidence", 0.76)),
                reason=crew_output.get("reason", "compliance crew evaluation"),
            )

        logger.info("compliance response sent proposalId=%s", proposal_id)
        participant.stop()

    participant.on("Proposal", handle_proposal)
    participant.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
