# Framework Hosting Design

## Overview

The MACP Example Showcase Service uses a **framework-neutral hosting architecture** that allows heterogeneous agent frameworks (LangGraph, LangChain, CrewAI, custom) to participate in the same MACP run through a unified control-plane contract.

## Architecture

```
POST /examples/run
  → CompilerService.compile()              [framework-agnostic]
  → applyRequestOverrides(tags/requester)  [merge UI-provided fields]
  → HostingService.resolve()               [materializes agent metadata]
  → ControlPlaneClient.validate()          [standard MACP contract]
  → ControlPlaneClient.createRun()         [standard MACP contract]
  → HostingService.attach()                [launches framework workers]
    → ProcessExampleAgentHostProvider
      → HostAdapterRegistry.get(framework)
      → ManifestValidator.validate(manifest)
      → AgentHostAdapter.prepareLaunch()
      → LaunchSupervisor.launch()
```

## Key Boundaries

### Compiler stays framework-agnostic

The compiler produces `ExecutionRequest` payloads with participants, runtime metadata, kickoff messages, and policy. It never references LangGraph, LangChain, or CrewAI.

### Hosting layer owns framework integration

All framework-specific launch logic lives in `src/hosting/adapters/`. Each adapter implements `AgentHostAdapter`:

```typescript
interface AgentHostAdapter {
  readonly framework: AgentFramework;
  validateManifest(manifest: AgentManifest): ManifestValidationResult;
  prepareLaunch(input: PrepareLaunchInput): PreparedLaunch;
}
```

### Control plane remains the only message ingress/egress

Workers communicate exclusively through the control plane HTTP API:
- `POST /runs/:id/messages` — send MACP messages
- `GET /runs/:id/events` — poll for run events
- `GET /runs/:id` — check run status

### Bootstrap contract

Every worker receives a stable `BootstrapPayload` via a temp JSON file (`MACP_BOOTSTRAP_FILE`):

```json
{
  "run": { "runId": "...", "traceId": "..." },
  "participant": { "participantId": "...", "role": "..." },
  "runtime": { "baseUrl": "...", "messageEndpoint": "...", "eventsEndpoint": "..." },
  "execution": { "scenarioRef": "...", "ttlMs": 300000, ... },
  "session": { "context": { ... }, "participants": [ ... ] },
  "agent": { "manifest": { ... }, "framework": "langgraph", "frameworkConfig": { ... } }
}
```

## Component Map

| Component | Path | Purpose |
|-----------|------|---------|
| Host Adapter Interface | `src/hosting/contracts/host-adapter.types.ts` | Framework adapter contract |
| Manifest Types | `src/hosting/contracts/manifest.types.ts` | Typed manifest schema |
| Bootstrap Types | `src/hosting/contracts/bootstrap.types.ts` | Bootstrap payload contract |
| LangGraph Adapter | `src/hosting/adapters/langgraph-host-adapter.ts` | LangGraph manifest validation + launch prep |
| LangChain Adapter | `src/hosting/adapters/langchain-host-adapter.ts` | LangChain manifest validation + launch prep |
| CrewAI Adapter | `src/hosting/adapters/crewai-host-adapter.ts` | CrewAI manifest validation + launch prep |
| Custom Adapter | `src/hosting/adapters/custom-host-adapter.ts` | Node/Python custom worker support |
| Adapter Registry | `src/hosting/host-adapter-registry.ts` | Maps framework → adapter |
| Manifest Validator | `src/hosting/manifest-validator.ts` | Pre-spawn validation |
| Launch Supervisor | `src/hosting/launch-supervisor.ts` | Process lifecycle management |
| Hosting Service | `src/hosting/hosting.service.ts` | Two-phase resolve + attach orchestration |
| Agent Profile Service | `src/catalog/agent-profile.service.ts` | Builds agent profiles with registry-scanned scenario coverage |
| Agent Catalog | `src/example-agents/example-agent-catalog.service.ts` | Hard-coded agent definitions (4 agents) |
| Python Worker SDK | `agents/sdk/python/macp_worker_sdk/` | Shared Python worker SDK: bootstrap loader, read-only control-plane client (get_run/get_events), Participant abstraction + PolicyStrategy. Emission delegates to `macp_sdk.DecisionSession` over direct gRPC. |
| Node Worker Runtime | `src/example-agents/runtime/` | In-tree TS modules for the custom (Node) Risk Agent: bootstrap loader, cancel-callback server, policy strategy, read-only CP observability client. Emission uses `macp-sdk-typescript` directly. |
| Policy Strategy | `src/example-agents/runtime/policy-strategy.ts` | Policy-aware decision logic for the coordinator (quorum, voting, veto) |

## Framework Workers

| Agent | Framework | Worker Path | Manifest |
|-------|-----------|-------------|----------|
| Fraud Agent | LangGraph | `agents/langgraph_worker/` | `agents/manifests/fraud-agent.json` |
| Growth Agent | LangChain | `agents/langchain_worker/` | `agents/manifests/growth-agent.json` |
| Compliance Agent | CrewAI | `agents/crewai_worker/` | `agents/manifests/compliance-agent.json` |
| Risk Agent | Custom (Node) | `src/example-agents/runtime/risk-decider.worker.ts` | `agents/manifests/risk-agent.json` |

Each worker gracefully falls back when its framework library is not installed, preserving the same MACP message contract.

## SDK Participant Abstraction

Python workers use the **Participant** SDK abstraction (`macp_worker_sdk.Participant`), which provides:
- **Handler registration** — `@participant.on('Proposal')`
- **Actions context** — `ctx.actions.evaluate()`, `ctx.actions.object()`, `ctx.actions.vote()`, `ctx.actions.commit()`.
  Under the hood, `Actions` holds a `macp_sdk.DecisionSession` and delegates to its mode-helpers; envelopes travel over the agent's own gRPC channel (RFC-MACP-0004 §4).
- **Poll-based event loop** — `participant.run()` polls the control-plane (read-only) for canonical events, dispatches to handlers, and enforces deadlines.
- **Event-to-handler dispatch** — `proposal.created` → `'Proposal'`, `proposal.updated` → handler key from `messageType`.

The Node risk-agent does not use Participant; it constructs `MacpClient` + `DecisionSession` directly in `src/example-agents/runtime/risk-decider.worker.ts` for tighter control over quorum timing.

The risk-agent coordinator additionally uses **PolicyStrategy** (`createPolicyStrategy(policyHints)`) for policy-driven:
- **Quorum**: `unanimous` waits for all; `majority`/`supermajority` needs threshold; `none` needs ≥1 response
- **Voting**: Approval rate vs threshold, with veto-blocking objections when `vetoEnabled` (configurable `vetoThreshold` per RFC-MACP-0012)
- **Confidence filtering**: Evaluations below `minimumConfidence` are disqualified from voting
- **Decision**: Maps signals to `approve` / `step_up` / `decline`
- **Commitment**: Includes `designatedRoles` for commitment authority tracking

## Policy Flow

```
scenario.yaml (policyVersion + policyHints)
  → template override (optional)
  → CompilerService → scenarioSpec.session.policyHints (internal scenario bookkeeping)
  → BootstrapPayload.execution.policyHints (threaded into every agent bootstrap)
  → Worker reads policyHints → PolicyStrategy.decide()
```

Note: `policyHints` do NOT travel to the control-plane. They live entirely in the scenario layer (examples-service) and are consumed by agent workers via their bootstrap file. The control-plane's `RunDescriptor` contract is scenario-agnostic — see `direct-agent-auth.md` for the full flow.
