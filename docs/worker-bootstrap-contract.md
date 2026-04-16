# Worker Bootstrap Contract

## Overview

Every MACP worker process receives a **bootstrap payload** — a JSON file containing everything needed to start participating in a run. This contract is framework-agnostic and stable across all host adapters.

As of April 2026 the contract carries direct-agent-auth fields (per-agent Bearer token, runtime gRPC address, initiator payload, cancel callback). See `docs/direct-agent-auth.md` for the end-to-end flow.

## Delivery Mechanism

The bootstrap payload is delivered via:
- **File path**: `MACP_BOOTSTRAP_FILE` environment variable points to a temp JSON file
- **Convenience env vars**: `MACP_CONTROL_PLANE_URL`, `MACP_FRAMEWORK`, `MACP_PARTICIPANT_ID`, `MACP_RUN_ID`, `MACP_SESSION_ID`, `MACP_RUNTIME_ADDRESS`, `MACP_RUNTIME_TOKEN`, `MACP_RUNTIME_TLS`, `MACP_RUNTIME_ALLOW_INSECURE`, `MACP_CANCEL_CALLBACK_HOST` / `_PORT` / `_PATH`, `MACP_LOG_LEVEL`

Legacy workers also receive `EXAMPLE_AGENT_*` and `CONTROL_PLANE_*` env vars for backward compatibility.

## Bootstrap Payload Schema

```typescript
interface BootstrapPayload {
  run: {
    runId: string;           // Unique run identifier
    sessionId: string;       // Pre-allocated UUID v4 — shared by every agent + CP
    traceId?: string;        // Distributed trace ID
  };
  participant: {
    participantId: string;   // This worker's participant ID
    agentId: string;         // Agent reference (e.g., "fraud-agent")
    displayName: string;     // Human-readable name
    role: string;            // Role in the session (e.g., "fraud", "risk")
  };
  runtime: {
    // Direct-agent-auth — populated when the examples-service has a token
    // for this agent; empty on legacy observability-only agents.
    address?: string;        // gRPC endpoint (e.g., "runtime.local:50051")
    bearerToken?: string;    // This agent's Bearer token (RFC-MACP-0004 §4)
    tls?: boolean;           // RFC-MACP-0006 §3 — default true in prod
    allowInsecure?: boolean; // Must be true when tls=false (local dev only)

    // Legacy HTTP observability — read-only after ES-8 narrowing.
    baseUrl: string;         // Control plane base URL
    messageEndpoint: string; // @deprecated — write path removed
    eventsEndpoint: string;  // Path to poll events
    apiKey?: string;         // Bearer token for control-plane HTTP polling
    timeoutMs: number;       // HTTP request timeout
    joinMetadata: {
      transport: "http" | "grpc";  // "grpc" when direct-agent-auth is active
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
  /** @deprecated Use `initiator.kickoff` instead. Retained for legacy workers. */
  kickoff?: {
    messageType: string;
    payload: Record<string, unknown>;
  };
  /**
   * Present ONLY on the initiator agent's bootstrap. Carries the payload
   * for the first SessionStart envelope and the first mode-specific envelope.
   */
  initiator?: {
    sessionStart: {
      intent: string;
      participants: string[];
      ttlMs: number;
      modeVersion: string;
      configurationVersion: string;
      policyVersion?: string;
      context?: Record<string, unknown>;
      roots?: { uri: string; name?: string }[];
    };
    kickoff?: {
      messageType: string;     // e.g. "Proposal"
      payloadType?: string;    // proto typeName (optional)
      payload: Record<string, unknown>;
    };
  };
  /** RFC-0001 §7.2 Option A: local HTTP endpoint the CP POSTs to cancel. */
  cancelCallback?: {
    host: string;
    port: number;
    path: string;
  };
}
```

## Worker Lifecycle (direct-agent-auth)

1. **Bootstrap**: Worker reads `MACP_BOOTSTRAP_FILE`.
2. **Authenticate**: Worker instantiates `MacpClient(address=runtime.address, auth=Auth.bearer(runtime.bearerToken, {expectedSender: participantId}))` and calls `initialize()`.
3. **Branch on initiator**:
   - **Initiator**: `DecisionSession.start(...)` then `.propose(kickoff.payload)`.
   - **Non-initiator**: `DecisionSession.openStream()` and react to events.
4. **Observe**: Worker optionally polls `GET /runs/{runId}/events?afterSeq=N` for read-only observability (policy quorum logic, etc.).
5. **Emit**: Worker uses mode-helper methods (`.evaluate`, `.vote`, `.commit`, `.raiseObjection`) on the `DecisionSession` — all writes go over gRPC to the runtime, never through the control-plane.
6. **Cancel callback**: Worker binds an HTTP listener at `cancelCallback.host/port/path`; on POST it calls `session.cancel(reason)`.
7. **Exit**: Worker exits on terminal run status or after emitting its committal envelope.

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
