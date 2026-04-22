# Direct-agent-auth in the examples-service

Last updated: 2026-04-21 (AUTH-2 JWT mode added).

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
  // ...existing fields
}
```

`runDescriptor.session` intentionally strips `policyHints`, `initiatorParticipantId`,
`participants[].role`, `commitments[]`, and `kickoff[]`; those live only on
`initiator`.

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
| `MACP_RUNTIME_ADDRESS` | gRPC endpoint shared by all agents. |
| `MACP_RUNTIME_TLS` / `MACP_RUNTIME_ALLOW_INSECURE` | TLS controls. |
| `MACP_AUTH_SERVICE_URL` | auth-service base URL — required; every spawn mints a JWT. |
| `MACP_AUTH_TOKEN_TTL_SECONDS` | Requested TTL for minted JWTs. Must exceed agent stream lifetime. |
| `MACP_CANCEL_CALLBACK_HOST` / `..._PORT_BASE` / `..._PATH` | Agent-side cancel listener. |

Spawned agents additionally receive:

| Variable | Meaning |
|---|---|
| `MACP_SESSION_ID` / `EXAMPLE_AGENT_SESSION_ID` | Pre-allocated UUID v4. |
| `MACP_RUNTIME_ADDRESS` / `MACP_RUNTIME_TOKEN` | gRPC identity for this agent. |
| `MACP_RUNTIME_TLS` / `MACP_RUNTIME_ALLOW_INSECURE` | Mirrors the examples-service config. |
| `MACP_CANCEL_CALLBACK_HOST` / `..._PORT` / `..._PATH` | Where this agent binds its cancel listener. |

## Adding a new agent

1. Register the agent's identity in the runtime (`MACP_AUTH_TOKENS_JSON`)
   with `can_start_sessions: true` if the agent may ever be an initiator.
2. Register the agent in `src/example-agents/example-agent-catalog.service.ts`
   and create a matching manifest in `agents/manifests/<agent>.json`.
3. Ensure the worker loads its bootstrap via `loadBootstrapPayload()` /
   `from_bootstrap()` and lets the SDK construct a `MacpClient` using
   `runtime.address + runtime.bearerToken`.

No control-plane or UI changes required. The Bearer token is minted per
spawn by the auth-service (AUTH-2) — no static configuration.

## AUTH-2 — on-demand JWT minting

Every agent spawn mints a short-lived RS256 JWT against the standalone
`auth-service` (`POST /tokens`). There is no static-token path.

### What the minter sends

```http
POST /tokens
Content-Type: application/json

{
  "sender": "<binding.participantId>",
  "ttl_seconds": <MACP_AUTH_TOKEN_TTL_SECONDS>,
  "scopes": {
    "can_start_sessions": <true iff binding is the initiator>,
    "is_observer": false,
    "allowed_modes": ["<scenario modeName>"]
  }
}
```

`MACP_AUTH_SCOPES_JSON[sender]` is deep-merged on top (use `null` to
clear a key). Initiator detection uses
`context.initiator?.participantId === binding.participantId`.

### Lifecycle constraint — no mid-stream refresh

Both SDKs bind the Bearer token to the gRPC channel once at stream open
(`typescript-sdk/src/client.ts:420`, `python-sdk/src/macp_sdk/client.py:84-97`)
and the runtime captures `AuthIdentity` once per stream
(`runtime/src/server.rs:861`). There is no refresh callback in either SDK.

**Consequences:**

- `MACP_AUTH_TOKEN_TTL_SECONDS` must exceed the agent process's gRPC
  stream lifetime — an agent whose token expires mid-stream will drop
  on the next reconnect.
- auth-service `MACP_AUTH_MAX_TTL_SECONDS` (default 3600s) caps the
  requested TTL. To run longer-lived agents, raise both knobs on the
  auth-service and here, or plan for process restarts before expiry.
- A follow-up ticket (AUTH-3) tracks adding a credentials-provider
  refresh hook to both SDKs + a `token_source` field to the bootstrap
  wire contract. Out of scope for AUTH-2.

### Deployment

1. Ensure the runtime has `MACP_AUTH_ISSUER`, `MACP_AUTH_AUDIENCE`, and
   `MACP_AUTH_JWKS_URL=<auth-service>/.well-known/jwks.json` set.
2. Run `auth-service` alongside runtime / control-plane. A sample sidecar
   is included in `docker-compose.dev.yml`.
3. Set `MACP_AUTH_SERVICE_URL=http://auth-service:3200` on the
   examples-service. A missing URL fails startup with `INVALID_CONFIG`.

### Observability

- Successful mints log `auth_mint_success sender=<id> expires_in=<s>s`.
- Failures log `auth_mint_failure sender=<id> reason=...` at warn level;
  the request surfaces `AUTH_MINT_FAILED` (HTTP 502).
- The token body is never logged (unit test `auth-token-minter.service.spec.ts`
  enforces this).

See `plans/auth-2-jwt-integration.md` for the full design, invariants,
and follow-up tickets (AUTH-3 SDK refresh, AUTH-4 auth-service AuthN,
AUTH-5 observer-binding field).

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
  `CompileLaunchResult`. Callers consume it directly — there is no legacy
  `executionRequest` shape.
- The examples-service no longer ships a control-plane HTTP client. Earlier
  versions in this tree held `src/control-plane/control-plane.client.ts`; that
  module was removed when the service moved to an observer-only control-plane
  model. If a future revision re-introduces a control-plane submit step, add
  a new module under `src/control-plane/` rather than reviving the old shape.
