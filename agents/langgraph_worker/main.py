#!/usr/bin/env python3
"""LangGraph fraud agent worker — runs a real graph and emits MACP messages.

Direct-agent-auth (RFC-MACP-0004 §4): this worker authenticates directly to
the MACP runtime over gRPC using a per-agent Bearer token loaded from its
bootstrap file. The control-plane is observed via read-only HTTP polling; it
NEVER forges envelopes on this agent's behalf.
"""

import sys
import os

_HERE = os.path.dirname(__file__)
# in-tree worker SDK (event loop, bootstrap loader, policy-strategy)
sys.path.insert(0, os.path.join(_HERE, '..', 'sdk', 'python'))
# python-sdk (direct-to-runtime MacpClient / DecisionSession) — fallback to
# path-install when the package isn't yet available on PyPI.
_SDK_SRC = os.path.join(_HERE, '..', '..', '..', 'python-sdk', 'src')
if os.path.isdir(_SDK_SRC) and _SDK_SRC not in sys.path:
    sys.path.insert(0, _SDK_SRC)

from macp_worker_sdk.bootstrap import log_agent  # noqa: E402
from macp_worker_sdk.participant import from_bootstrap  # noqa: E402

from graph import build_graph  # noqa: E402
from mappers import map_kickoff_to_state  # noqa: E402


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
