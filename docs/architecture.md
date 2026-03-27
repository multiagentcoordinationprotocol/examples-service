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
  catalog/           → Pack/scenario listing (read-only)
  compiler/          → Input validation (AJV) + template substitution + ExecutionRequest assembly
  config/            → Environment-based configuration (global module)
  contracts/         → TypeScript interfaces — registry types, launch types, agent types
  control-plane/     → HTTP client for the control plane (/runs/validate, /runs)
  controllers/       → REST endpoints (health, catalog, launch, examples)
  dto/               → Swagger-annotated request/response DTOs
  errors/            → AppException, ErrorCode enum, GlobalExceptionFilter
  example-agents/    → Hard-coded example agent catalog (fraud, growth, risk)
  hosting/           → Agent bootstrap orchestration + pluggable host provider
  launch/            → Launch schema generation + ExampleRunService (full showcase flow)
  middleware/        → Correlation ID + request logging
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
GET /packs → CatalogService → RegistryIndexService → FileRegistryLoader → YAML files
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
    → Substitute {{ inputs.* }} in context/metadata/kickoff templates
    → Build ExecutionRequest
```

### 4. Run Example (Full Showcase Flow)

```
POST /examples/run
  → ExampleRunService
    1. Compile (same as above)
    2. Bootstrap agents → HostingService → InMemoryExampleAgentHostProvider
       → Inject transport identities into ExecutionRequest participants
    3. Submit to control plane (optional)
       → ControlPlaneClient.validate() + .createRun()
    4. Return compiled + hostedAgents + controlPlane status
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

The example agents (fraud-agent, growth-agent, risk-agent) use a **manifest-only** bootstrap strategy:

- No actual framework runtime is required
- The service resolves agent definitions from a hard-coded catalog
- Transport identities are injected into the ExecutionRequest
- Framework entrypoints are recorded as metadata

This is intentionally deferred — plug in a real LangGraph/LangChain/custom host provider when ready.

## Caching

`RegistryIndexService` caches the loaded registry snapshot with a configurable TTL:

- `REGISTRY_CACHE_TTL_MS=0` — reload from disk on every request (development)
- `REGISTRY_CACHE_TTL_MS=60000` — cache for 60 seconds (production)

Call `invalidate()` to force a reload.
