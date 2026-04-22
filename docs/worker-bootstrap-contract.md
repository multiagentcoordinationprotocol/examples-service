# Worker Bootstrap Contract

## Overview

Every MACP worker process receives a **bootstrap payload** — a JSON file
containing everything needed to start participating in a run. The shape is
flat and framework-agnostic; both `macp_sdk` (Python) and
`macp-sdk-typescript` consume it verbatim via their `fromBootstrap()` entry
points.

As of April 2026 the contract carries direct-agent-auth fields — a per-agent
Bearer token, the runtime gRPC address, an initiator payload, and an optional
cancel-callback tuple. See `docs/direct-agent-auth.md` for the end-to-end
flow.

## Delivery mechanism

- **File path**: `MACP_BOOTSTRAP_FILE` environment variable points to a temp
  JSON file written by `LaunchSupervisor.writeBootstrapFile()` before the
  worker process is spawned.
- **Convenience env vars**: `MACP_FRAMEWORK`, `MACP_PARTICIPANT_ID`,
  `MACP_RUN_ID`, `MACP_SESSION_ID`, `MACP_RUNTIME_ADDRESS`,
  `MACP_RUNTIME_TOKEN`, `MACP_RUNTIME_TLS`, `MACP_RUNTIME_ALLOW_INSECURE`,
  `MACP_CANCEL_CALLBACK_HOST` / `_PORT` / `_PATH`, `MACP_LOG_LEVEL`. These are
  populated by `buildAgentEnv()` in
  `src/hosting/adapters/agent-env.ts` and are intended as a convenience —
  the JSON file is authoritative.

## Bootstrap payload schema

The canonical TypeScript definition lives at
`src/hosting/contracts/bootstrap.types.ts`. The shape is intentionally flat
and uses `snake_case` keys so it matches the upstream SDKs' `fromBootstrap`
expectations:

```typescript
interface BootstrapPayload {
  participant_id: string;           // Agent's sender identity in this session
  session_id: string;               // UUID v4, allocated at compile time
  mode: string;                     // e.g. "macp.mode.decision.v1"
  runtime_url: string;              // gRPC endpoint (e.g. "runtime.local:50051")
  auth_token?: string;              // Per-agent Bearer token (RFC-MACP-0004 §4)
  agent_id?: string;                // Dev-only identity header value
  secure?: boolean;                 // TLS flag (RFC-MACP-0006 §3)
  allow_insecure?: boolean;         // Required when secure=false
  participants?: string[];          // All participant IDs in the session
  mode_version?: string;
  configuration_version?: string;
  policy_version?: string;

  /** Present ONLY on the initiator agent's bootstrap. */
  initiator?: {
    session_start: {
      intent: string;
      participants: string[];
      ttl_ms: number;
      mode_version: string;
      configuration_version: string;
      policy_version?: string;
      context?: Record<string, unknown>;
      context_id?: string;
      extensions?: Record<string, unknown>;
      roots?: Array<{ uri: string; name?: string }>;
    };
    kickoff?: {
      message_type: string;         // e.g. "Proposal"
      payload_type?: string;        // proto typeName (optional)
      payload: Record<string, unknown>;
    };
  };

  /** RFC-0001 §7.2 Option A: local HTTP endpoint for cancel delivery. */
  cancel_callback?: {
    host: string;
    port: number;
    path: string;
  };

  /** Metadata not consumed by the SDK; available to agent logic. */
  metadata?: {
    run_id?: string;
    trace_id?: string;
    scenario_ref?: string;
    role?: string;
    framework?: string;
    agent_ref?: string;
    policy_hints?: Record<string, unknown>;   // RFC-MACP-0012 shape
    session_context?: Record<string, unknown>;
  };
}
```

`metadata.policy_hints` carries the RFC-MACP-0012 fields consumed by
`PolicyStrategy`:

| Field                 | Default | Description                                                         |
|-----------------------|---------|---------------------------------------------------------------------|
| `type`                | `none`  | `majority`, `supermajority`, `unanimous`, `none`                    |
| `threshold`           | —       | Approval rate (0–1) required to pass                                |
| `vetoEnabled`         | `false` | Whether critical-severity objections veto                           |
| `vetoThreshold`       | `1`     | Number of critical objections required for veto                     |
| `minimumConfidence`   | `0.0`   | Minimum confidence for an evaluation to count                       |
| `designatedRoles`     | `[]`    | Roles allowed to author the terminal commitment                     |

## Worker lifecycle (direct-agent-auth)

1. **Bootstrap** — worker reads `MACP_BOOTSTRAP_FILE`.
2. **Authenticate** — SDK constructs the gRPC client using `runtime_url` +
   `auth_token`. TLS is enforced unless `secure=false` *and*
   `allow_insecure=true`.
3. **Branch on initiator**:
   - **Initiator** — SDK emits `SessionStart` with `initiator.session_start`
     and then the first mode-specific envelope described by
     `initiator.kickoff`.
   - **Non-initiator** — SDK opens the session stream and waits for history
     replay + live events (RFC-MACP-0006 §3.2 passive subscribe).
4. **React** — handlers receive `Proposal`, `Evaluation`, `Objection`, `Vote`,
   `Commitment`, etc., depending on the mode.
5. **Emit** — `ctx.actions.evaluate() / .vote() / .commit() / .objection()`
   write directly to the runtime over the agent's own gRPC channel.
6. **Cancel callback** — if `cancel_callback` is present, the worker binds a
   small HTTP listener; the control-plane (or an operator) POSTs
   `{ runId, reason }` to trigger a graceful shutdown.
7. **Exit** — terminal status closes the stream; `participant.onTerminal()`
   fires and the worker exits.

## Using the Python SDK

```python
from macp_sdk.agent import from_bootstrap

participant = from_bootstrap()  # reads MACP_BOOTSTRAP_FILE automatically

def handle_proposal(message, ctx):
    ctx.actions.evaluate(
        message.proposal_id or "",
        "APPROVE",
        confidence=0.85,
        reason="looks good",
    )
    participant.stop()

participant.on("Proposal", handle_proposal)
participant.run()
```

See `agents/langgraph_worker/main.py`, `agents/langchain_worker/main.py`, and
`agents/crewai_worker/main.py` for end-to-end examples that wire a real
LangGraph graph / LangChain chain / CrewAI crew into this skeleton.

## Using the Node SDK

```typescript
import { agent } from 'macp-sdk-typescript';

const participant = agent.fromBootstrap();

participant.on('Proposal', async (message, ctx) => {
  await ctx.actions.evaluate?.({
    proposalId: message.proposalId ?? '',
    recommendation: 'APPROVE',
    confidence: 0.85,
    reason: 'acceptable risk'
  });
  await participant.stop();
});

await participant.run();
```

The in-tree coordinator at `src/example-agents/runtime/risk-decider.worker.ts`
follows this pattern; the only extra machinery it owns is the
`PolicyStrategy` (quorum + voting + veto) and the cancel-callback HTTP server
at `src/example-agents/runtime/cancel-callback-server.ts`.
