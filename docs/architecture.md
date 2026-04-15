# Architecture

## Overview

The MACP Example Showcase Service is a single NestJS service that intentionally combines three responsibilities for demo simplicity:

1. **Catalog** — browse example scenario packs and their versions
2. **Compiler** — validate user inputs and compile them into control-plane-ready `ExecutionRequest` payloads
3. **Hosting** — resolve and bootstrap example agent bindings (manifest-only by default)

> This service is a showcase/examples layer used to demonstrate scenarios and sample agents for MACP. It intentionally combines catalog, compilation, and sample agent hosting for simplicity. It is not the production system boundary.

## Clean Demo Split

In a production deployment, these three things are separate:

| Concern | Demo (this service) | Production |
|---------|-------------------|------------|
| Scenario catalog | Example Showcase Service | Scenario Registry |
| Compilation | Example Showcase Service | Scenario Registry or Control Plane |
| Agent hosting | Example Showcase Service | Agent Platform / Runtime |
| Run lifecycle | Control Plane | Control Plane |
| Coordination | MACP Runtime | MACP Runtime |

## Module Structure

```
src/
  catalog/           → Pack/scenario listing + AgentProfileService (scenario coverage computation)
  compiler/          → Input validation (AJV) + template substitution + ExecutionRequest assembly
  config/            → Environment-based configuration (global module)
  contracts/         → TypeScript interfaces — registry types, launch types, agent types
  control-plane/     → HTTP client for the control plane (/runs/validate, /runs)
  controllers/       → REST endpoints (health, catalog, launch, examples, agents)
  dto/               → Swagger-annotated request/response DTOs
  errors/            → AppException, ErrorCode enum, GlobalExceptionFilter
  example-agents/    → Hard-coded example agent catalog (fraud, growth, compliance, risk)
    runtime/         → Worker runtime: control-plane client + risk-decider worker
  hosting/           → Two-phase agent hosting (resolve + attach) + pluggable host providers
  launch/            → Launch schema generation + ExampleRunService (full showcase flow)
  middleware/        → Correlation ID + request logging + API key guard
  registry/          → File-backed YAML loader + in-memory cache index
```

## Request Flow

```
HTTP Request
  → CorrelationIdMiddleware (X-Correlation-ID)
  → RequestLoggerMiddleware (timing/status)
  → Controller
    → Service
      → Registry / Compiler / Hosting
  → Response
  → GlobalExceptionFilter (catches errors)
```

## Key Flows

### 1. Browse Catalog

```
GET /packs             → CatalogService.listPacks() → RegistryIndexService → FileRegistryLoader → YAML files
GET /packs/:p/scenarios → CatalogService.listScenarios() → same path
GET /scenarios          → CatalogService.listAllScenarios() → scans all packs, adds packSlug to each
```

### 2. Get Launch Schema

```
GET /packs/:pack/scenarios/:scenario/versions/:version/launch-schema
  → LaunchService
    → Load scenario + optional template
    → Extract schema defaults, merge template defaults
    → Summarize participants with agent previews
    → Return form schema, defaults, runtime hints
```

### 3. Compile Scenario

```
POST /launch/compile
  → CompilerService
    → Parse scenarioRef (pack/scenario@version)
    → Load scenario + optional template
    → Merge defaults: schema < template < user inputs
    → Validate inputs against JSON Schema (AJV)
    → Substitute {{ inputs.* }} in context/metadata/kickoff/commitments templates
    → Build ExecutionRequest (carries session.commitments[] when scenario declares them)
```

### 4. Run Example (Full Showcase Flow)

```
POST /examples/run
  → ExampleRunService
    1. Compile (same as above)
    2. Apply request overrides (tags, requester, runLabel) if provided
    3. Resolve agents → HostingService.resolve() → ProcessExampleAgentHostProvider
       → Inject transport identities into ExecutionRequest participants
    4. Submit to control plane (optional)
       → ControlPlaneClient.validate() + .createRun()
    5. Attach agents → HostingService.attach() → Spawn Python/Node worker processes
       → Workers poll control plane for events, send MACP messages back
    6. Return compiled + hostedAgents + controlPlane status
```

### 5. Browse Agents

```
GET /agents
  → AgentProfileService.listProfiles()
    1. Load all definitions from ExampleAgentCatalogService.list()
    2. Scan registry: for each pack → scenario → participant, build agentRef → scenarioRef[] map
    3. Merge definition metadata with scenario coverage and metrics
    4. Return AgentProfileDto[]

GET /agents/:agentRef
  → AgentProfileService.getProfile(agentRef)
    → Same as above for a single agent (404 AGENT_NOT_FOUND if missing)
```

## Data Flow: Scenario Packs

```
packs/{pack-slug}/
  pack.yaml                              → PackFile (metadata)
  scenarios/{scenario-slug}/{version}/
    scenario.yaml                        → ScenarioVersionFile (inputs schema, launch config, runtime)
    templates/
      default.yaml                       → ScenarioTemplateFile (defaults + overrides)
      *.yaml                             → Additional template variants
```

Templates override scenario defaults and launch configuration. The merge precedence is:

```
schema defaults < template defaults < user inputs
```

## Agent Hosting Strategy

The example agents use an **active process-backed** hosting strategy:

- Service resolves agent definitions from a hard-coded catalog (fraud, growth, compliance, risk)
- Transport identities are injected into the ExecutionRequest before submission
- After the control plane creates a run, lightweight Python and Node worker processes are spawned
- Workers poll the control plane for run state and events (`GET /runs/:id/events`)
- Workers send session-bound MACP messages back via `POST /runs/:id/messages`
- Each framework is demonstrated: LangGraph (fraud), LangChain (growth), CrewAI (compliance), custom (risk)
- The `InMemoryExampleAgentHostProvider` is available as a manifest-only fallback for environments without Python

## Caching

`RegistryIndexService` caches the loaded registry snapshot with a configurable TTL:

- `REGISTRY_CACHE_TTL_MS=0` — reload from disk on every request (development)
- `REGISTRY_CACHE_TTL_MS=60000` — cache for 60 seconds (production)

Call `invalidate()` to force a reload.
