# Worker Bootstrap Contract

## Overview

Every MACP worker process receives a **bootstrap payload** — a JSON file containing everything needed to start participating in a run. This contract is framework-agnostic and stable across all host adapters.

## Delivery Mechanism

The bootstrap payload is delivered via:
- **File path**: `MACP_BOOTSTRAP_FILE` environment variable points to a temp JSON file
- **Convenience env vars**: `MACP_CONTROL_PLANE_URL`, `MACP_FRAMEWORK`, `MACP_PARTICIPANT_ID`, `MACP_RUN_ID`, `MACP_LOG_LEVEL`

Legacy workers also receive `EXAMPLE_AGENT_*` and `CONTROL_PLANE_*` env vars for backward compatibility.

## Bootstrap Payload Schema

```typescript
interface BootstrapPayload {
  run: {
    runId: string;           // Unique run identifier
    sessionId?: string;      // Optional session ID
    traceId?: string;        // Distributed trace ID
  };
  participant: {
    participantId: string;   // This worker's participant ID
    agentId: string;         // Agent reference (e.g., "fraud-agent")
    displayName: string;     // Human-readable name
    role: string;            // Role in the session (e.g., "fraud", "risk")
  };
  runtime: {
    baseUrl: string;         // Control plane base URL
    messageEndpoint: string; // Path to send messages (e.g., "/runs/{runId}/messages")
    eventsEndpoint: string;  // Path to poll events (e.g., "/runs/{runId}/events")
    apiKey?: string;         // Bearer token for control plane auth
    timeoutMs: number;       // HTTP request timeout
    joinMetadata: {
      transport: "http";
      messageFormat: "macp";
    };
  };
  execution: {
    scenarioRef: string;     // e.g., "fraud/high-value-new-device@1.0.0"
    modeName: string;        // e.g., "macp.mode.decision.v1"
    modeVersion: string;
    configurationVersion: string;
    policyVersion?: string;  // e.g., "policy.fraud.majority-veto"
    policyHints?: {          // Policy metadata (RFC-MACP-0012 aligned)
      type?: string;         // e.g., "majority", "unanimous", "none"
      description?: string;
      threshold?: number;    // Voting threshold (0-1)
      vetoEnabled?: boolean;
      vetoRoles?: string[];
      vetoThreshold?: number;      // Blocking objections needed for veto (default 1)
      minimumConfidence?: number;  // Min confidence for evaluations (default 0.0)
      designatedRoles?: string[];  // Roles with commitment authority
    };
    ttlMs: number;           // Session time-to-live
    initiatorParticipantId?: string;
    tags?: string[];
    requester?: string;
  };
  session: {
    context: Record<string, unknown>;  // Session context (scenario inputs)
    participants: string[];             // All participant IDs in the run
    metadata?: Record<string, unknown>;
  };
  agent: {
    manifest: Record<string, unknown>;       // The agent's manifest
    framework: string;                        // "langgraph", "langchain", "crewai", "custom"
    frameworkConfig?: Record<string, unknown>; // Framework-specific config
  };
  kickoff?: {
    messageType: string;     // Expected first message type
    payload: Record<string, unknown>;
  };
}
```

## Worker Lifecycle

1. **Bootstrap**: Worker starts, reads `MACP_BOOTSTRAP_FILE`, initializes SDK
2. **Poll**: Worker polls `GET /runs/{runId}/events?afterSeq=0` for run events
3. **React**: On receiving a relevant event (e.g., `proposal.created`), worker processes it
4. **Respond**: Worker sends MACP messages via `POST /runs/{runId}/messages`
5. **Exit**: Worker exits after sending its response or when the run reaches a terminal state

## Using the Python SDK (Participant Abstraction)

```python
from macp_worker_sdk.participant import from_bootstrap
from macp_worker_sdk.bootstrap import log_agent

participant = from_bootstrap()

@participant.on('Proposal')
def handle_proposal(ctx):
    # ctx.bootstrap — full BootstrapContext (session_context, policy_hints, etc.)
    # ctx.actions — evaluate(), object(), vote(), commit()
    # ctx.proposal_id, ctx.sender, ctx.payload — event data
    ctx.actions.evaluate(
        proposal_id=ctx.proposal_id,
        recommendation='APPROVE',
        confidence=0.85,
        reason='looks good',
    )
    participant.stop()

participant.run()
```

## Using the Node SDK (Participant Abstraction)

```typescript
import { Participant, loadBootstrap, logAgent } from '../sdk/node';

const bootstrap = loadBootstrap();
const participant = new Participant(bootstrap);

participant.on('Proposal', async (ctx) => {
  await ctx.actions.evaluate({
    proposalId: ctx.proposalId!,
    recommendation: 'APPROVE',
    confidence: 0.85,
    reason: 'acceptable risk'
  });
  participant.stop();
});

await participant.run();
```

## Low-Level SDK (Direct Client Access)

The `Participant` abstraction is the recommended approach. For advanced use cases, you can still use the low-level client directly:

```python
from macp_worker_sdk import load_bootstrap, ControlPlaneClient, MacpMessageBuilder

ctx = load_bootstrap()
client = ControlPlaneClient(ctx)
builder = MacpMessageBuilder(ctx.run_id, ctx.participant_id, ctx.framework, ctx.participant.agent_id)
events = client.get_events(after_seq=0)
msg = builder.evaluation(proposal_id, 'APPROVE', 0.85, 'looks good', recipients)
client.send_message(msg)
```
