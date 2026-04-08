#!/usr/bin/env python3
"""LangChain growth agent worker — runs a real chain and emits MACP messages."""

import sys
import os

# Add SDK to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from macp_worker_sdk.bootstrap import log_agent
from macp_worker_sdk.participant import from_bootstrap

from chain import build_agent
from mappers import map_kickoff_to_inputs


def main() -> int:
    participant = from_bootstrap()
    chain = build_agent()

    @participant.on('Proposal')
    def handle_proposal(ctx):
        chain_input = map_kickoff_to_inputs(ctx.bootstrap.session_context)
        chain_output = chain.invoke(chain_input)

        log_agent(
            'chain execution complete',
            recommendation=chain_output.get('recommendation'),
            confidence=chain_output.get('confidence'),
        )

        ctx.actions.evaluate(
            proposal_id=ctx.proposal_id,
            recommendation=chain_output.get('recommendation', 'REVIEW'),
            confidence=chain_output.get('confidence', 0.5),
            reason=chain_output.get('reason', 'growth chain evaluation'),
        )

        log_agent('evaluation sent', proposalId=ctx.proposal_id)
        participant.stop()

    participant.run()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
