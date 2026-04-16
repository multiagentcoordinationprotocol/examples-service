#!/usr/bin/env python3
"""LangChain growth agent worker — runs a real chain and emits MACP messages.

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

from chain import build_agent  # noqa: E402
from mappers import map_kickoff_to_inputs  # noqa: E402


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
