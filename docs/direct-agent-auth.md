# Direct-agent-auth in the examples-service

Last updated: 2026-04-15.

This document describes the direct-agent-authentication flow introduced by the
[`ui-console/plans/direct-agent-auth.md`](../../ui-console/plans/direct-agent-auth.md)
plan. It covers examples-service responsibilities: how scenarios compile, how
bootstrap is written, how agents reach the runtime, and how cancellation is
wired.

See `CLAUDE.md` § "Direct-agent-auth" for a short summary.

## Why

Before this change, every spawned agent emitted envelopes by POSTing to the
control-plane's `/runs/:id/messages` route, and the control-plane forged
`SessionStart` on the agent's behalf. That violates **RFC-MACP-0004 §4**
("sender MUST be derived from authenticated identity") and **RFC-MACP-0001 §5.3**
("no MACP bypass"). The plan re-homes envelope emission to agents themselves
and narrows the control-plane to a read-only observer.

## Architectural invariants

1. **Agents authenticate to the runtime directly** (their own Bearer token).
2. **The initiator agent opens the session** via `DecisionSession.start()`.
3. **The control-plane is scenario-agnostic** — it does not inspect policy hints,
   kickoff templates, roles, or commitments.
4. **Control-plane never calls `Send`.** Observer-only.
5. **session_id is owned by the examples-service** (UUID v4 allocated at compile time).
6. **Cancellation stays with the initiator** (Option A: agent callback);
   policy-delegated (Option B) is opt-in.

## Compile output (twin artifacts)

`CompilerService.compile()` now produces:

```ts
interface CompileLaunchResult {
  sessionId: string;            // UUID v4 — shared by every agent + control-plane
  runDescriptor: RunDescriptor; // generic POST /runs body (no scenario-specific fields)
  initiator?: InitiatorPayload; // SessionStart + kickoff for exactly one participant
  executionRequest: ExecutionRequest; // legacy, still sent to the current control-plane
  // ...existing fields
}
```

`runDescriptor.session` intentionally strips `policyHints`, `initiatorParticipantId`,
`participants[].role`, `commitments[]`, and `kickoff[]`; those live only on
`initiator` (and on the legacy `executionRequest` until CP-1 lands).

## Agent bootstrap schema (`src/hosting/contracts/bootstrap.types.ts`)

Each spawned agent receives a JSON bootstrap file at `$MACP_BOOTSTRAP_FILE`:

```ts
interface BootstrapPayload {
  run: { runId: string; sessionId: string; traceId?: string };   // sessionId now mandatory
  participant: { participantId, agentId, displayName, role };
  runtime: {
    address?: string;          // gRPC endpoint (new)
    bearerToken?: string;      // per-agent Bearer token (new)
    tls?: boolean;             // RFC-0006 §3 (new)
    allowInsecure?: boolean;   // local-dev escape (new)
    baseUrl: string;           // control-plane HTTP (read-only observability)
    messageEndpoint: string;   // @deprecated — agents don't write here anymore
    eventsEndpoint: string;
    apiKey?: string;
    timeoutMs: number;
    joinMetadata: { transport: 'http' | 'grpc'; messageFormat: 'macp' };
  };
  execution: { scenarioRef, modeName, modeVersion, configurationVersion, policyVersion?, policyHints?, ttlMs, initiatorParticipantId?, ... };
  session: { context, participants, metadata? };
  agent: { manifest, framework, frameworkConfig? };
  initiator?: {                // present ONLY on the initiator agent's bootstrap
    sessionStart: { intent, participants, ttlMs, modeVersion, configurationVersion, policyVersion?, context?, roots? };
    kickoff?: { messageType: string; payloadType?: string; payload: Record<string, unknown> };
  };
  cancelCallback?: {            // RFC-0001 §7.2 Option A
    host: string;
    port: number;
    path: string;
  };
}
```

## End-to-end flow

```
UI → examples-service: POST /examples/run
  ↓
examples-service compiles scenario → {runDescriptor, executionRequest, initiator, sessionId}
  ↓
examples-service: spawns N agent processes with per-agent bootstrap files
  (initiator agent's file has `initiator.session_start + kickoff`)
  ↓
Each agent:
  - reads MACP_BOOTSTRAP_FILE
  - SDK (macp_sdk / macp-sdk-typescript) opens the runtime gRPC channel using
    runtime_url + auth_token and calls initialize()
  - if initiator: session.start() + first mode envelope (e.g. Proposal)
    else: session.openStream() and react to history replay + live events
  - binds cancel-callback HTTP server at cancel_callback.host/port/path
  ↓
Control-plane observer: StreamSession(sessionId, read-only)
                        → projection → SSE broadcast to UI
```

## Environment variables

See `CLAUDE.md` for the full table. The direct-agent-auth additions:

| Variable | Purpose |
|---|---|
| `EXAMPLES_SERVICE_AGENT_TOKENS_JSON` | `{"sender":"bearer"}` map threaded into each agent's bootstrap. |
| `MACP_RUNTIME_ADDRESS` | gRPC endpoint shared by all agents. |
| `MACP_RUNTIME_TLS` / `MACP_RUNTIME_ALLOW_INSECURE` | TLS controls. |
| `MACP_CANCEL_CALLBACK_HOST` / `..._PORT_BASE` / `..._PATH` | Agent-side cancel listener. |

Spawned agents additionally receive:

| Variable | Meaning |
|---|---|
| `MACP_SESSION_ID` / `EXAMPLE_AGENT_SESSION_ID` | Pre-allocated UUID v4. |
| `MACP_RUNTIME_ADDRESS` / `MACP_RUNTIME_TOKEN` | gRPC identity for this agent. |
| `MACP_RUNTIME_TLS` / `MACP_RUNTIME_ALLOW_INSECURE` | Mirrors the examples-service config. |
| `MACP_CANCEL_CALLBACK_HOST` / `..._PORT` / `..._PATH` | Where this agent binds its cancel listener. |

## Adding a new agent

1. Generate a Bearer token for the agent.
2. Add `"<sender>": "<bearer-token>"` to
   `EXAMPLES_SERVICE_AGENT_TOKENS_JSON`.
3. Add the same identity to the runtime's `MACP_AUTH_TOKENS_JSON` with
   `can_start_sessions: true` (if the agent may ever be an initiator) or
   `false` otherwise.
4. Register the agent in `src/example-agents/example-agent-catalog.service.ts`.
5. Ensure the worker loads its bootstrap via `loadBootstrapPayload()` and
   constructs a `MacpClient` using `runtime.address + runtime.bearerToken`.

No control-plane or UI changes required.

## Cross-repo dependencies

This plan has matching tasks in:

- `python-sdk` — PY-1..6 (secure default, `expected_sender`, publish). **Done
  upstream** (v0.2.0 features present in-tree).
- `typescript-sdk` — TS-1..5 (secure default, `expectedSender`). **Done
  upstream** (v0.2.0 features present in-tree).
- `control-plane` — CP-1..15 (RunDescriptor contract, sessionId response,
  delete forged-envelope paths, observer-mode). **Not yet landed** — the
  examples-service continues to POST `executionRequest` until CP-1 ships.
- `ui-console` — UI-1..5 (remove operator inject panel). Independent of
  examples-service.

## Forward-compat notes

- The `executionRequest.session.metadata.sessionId` carries the compiled
  sessionId, so observer tooling that reads metadata already sees the same
  id as the agents use.
- `runDescriptor` is produced on every compile and returned in the
  `CompileLaunchResult` alongside the legacy `executionRequest`. When a caller
  is ready to switch to the scenario-agnostic contract, it can consume
  `compiled.runDescriptor` instead of `compiled.executionRequest` with no
  changes to the examples-service.
- The examples-service no longer ships a control-plane HTTP client. Earlier
  versions in this tree held `src/control-plane/control-plane.client.ts`; that
  module was removed when the service moved to an observer-only control-plane
  model. If a future revision re-introduces a control-plane submit step, add
  a new module under `src/control-plane/` rather than reviving the old shape.
