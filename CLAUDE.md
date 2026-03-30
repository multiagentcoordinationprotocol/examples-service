# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MACP Example Showcase Service — a NestJS application that combines scenario catalog, compilation, and example-agent bootstrap into a single service for demonstrating MACP concepts. It loads scenario packs from YAML files, exposes a browsable catalog API, compiles user inputs into ExecutionRequest payloads, and resolves example agent bindings.

The service features a **framework-neutral hosting architecture** that launches real framework-backed agents (LangGraph, LangChain, CrewAI, custom) that all communicate through the same MACP control-plane contract.

This is intentionally a demo/showcase service, not a production system boundary.

## Commands

```bash
npm run build              # Compile TypeScript (nest build)
npm run start:dev          # Dev server with watch mode
npm run start:debug        # Debug with watch mode
npm test                   # Run unit tests (Jest, 196 tests)
npm test -- --testPathPattern=compiler  # Run a single test file by name
npm run test:e2e           # E2E tests (supertest, 22 tests)
npm run lint               # ESLint check
npm run lint:fix           # ESLint auto-fix
npm run format             # Prettier formatting
```

Docker: `docker compose -f docker-compose.dev.yml up` for local dev with hot reload.

## Architecture

**Request flow:** HTTP → CorrelationIdMiddleware → RequestLoggerMiddleware → Controller → Service → Response (GlobalExceptionFilter catches errors)

**Key modules:**

- **Registry** (`src/registry/`) — `FileRegistryLoader` discovers and parses YAML pack files from `PACKS_DIR`. `RegistryIndexService` caches the loaded index with configurable TTL (`REGISTRY_CACHE_TTL_MS`, 0 = reload every request).
- **Catalog** (`src/catalog/`) — Read-only endpoints to browse packs and scenarios with agent refs and runtime info.
- **Compiler** (`src/compiler/`) — `CompilerService` validates inputs against JSON Schema (ajv), `template-resolver` handles `{{ inputs.* }}` substitution, default merging (`deepMerge`), and `parseScenarioRef`.
- **Launch** (`src/launch/`) — `LaunchService` generates launch schemas with agent previews. `ExampleRunService` orchestrates the full showcase flow (compile → resolve agents → submit → attach workers).
- **Example Agents** (`src/example-agents/`) — Catalog of four demo agents (fraud/LangGraph, growth/LangChain, compliance/CrewAI, risk/custom) with manifest-driven definitions. Worker runtime utilities in `src/example-agents/runtime/`.
- **Hosting** (`src/hosting/`) — Framework-neutral hosting via adapter pattern. `HostAdapterRegistry` maps framework → adapter. `ManifestValidator` validates before spawn. `LaunchSupervisor` manages process lifecycle. `ProcessExampleAgentHostProvider` orchestrates resolve/attach. See `docs/framework-hosting-design.md` for full details.
  - **Adapters** (`src/hosting/adapters/`) — `LangGraphHostAdapter`, `LangChainHostAdapter`, `CrewAIHostAdapter`, `CustomHostAdapter`.
  - **Contracts** (`src/hosting/contracts/`) — `AgentManifest`, `BootstrapPayload`, `AgentHostAdapter` interfaces.
- **Control Plane** (`src/control-plane/`) — HTTP client for `/runs/validate` and `/runs` on the control plane.
- **Config** (`src/config/`) — `AppConfigService` is a global module wrapping environment variables including control plane settings.
- **Contracts** (`src/contracts/`) — TypeScript interfaces for registry types, launch payloads, and example agent definitions.
- **Errors** (`src/errors/`) — `AppException` with `ErrorCode` enum, `GlobalExceptionFilter`.
- **Middleware** (`src/middleware/`) — `CorrelationIdMiddleware`, `RequestLoggerMiddleware`, `ApiKeyGuard` (optional API key auth via `AUTH_API_KEYS`). Rate limiting via `@nestjs/throttler` (100 req/min default).

**Framework Workers** (`agents/`):

- `agents/langgraph_worker/` — Real LangGraph graph for fraud detection (falls back without langgraph installed)
- `agents/langchain_worker/` — Real LangChain chain for growth analysis (falls back without langchain installed)
- `agents/crewai_worker/` — Real CrewAI crew for compliance review (falls back without crewai installed)
- `agents/sdk/python/macp_worker_sdk/` — Shared Python SDK (bootstrap, control plane client, message builder)
- `agents/sdk/node/` — Shared Node SDK (same contract)
- `agents/manifests/` — JSON manifest files defining each agent's framework config
- `agents/python/` — Legacy shim workers (preserved for backward compatibility)

**API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | Liveness probe |
| GET | `/packs` | List all scenario packs |
| GET | `/packs/:packSlug/scenarios` | List scenarios with versions, templates, agent refs |
| GET | `/packs/:packSlug/scenarios/:scenarioSlug/versions/:version/launch-schema` | Get form schema, defaults, agent previews |
| POST | `/launch/compile` | Validate inputs & compile ExecutionRequest |
| POST | `/examples/run` | Full showcase: compile + bootstrap agents + optionally submit to control plane |
| GET | `/docs` | Swagger UI (dev only, when NODE_ENV=development) |

## Scenario Packs

Three demo packs are included:

| Pack | Scenario | Frameworks Used |
|------|----------|-----------------|
| `fraud` | `high-value-new-device` | LangGraph + LangChain + CrewAI + Custom |
| `lending` | `loan-underwriting` | LangGraph + LangChain + CrewAI + Custom |
| `claims` | `auto-claim-review` | LangGraph + LangChain + CrewAI + Custom |

### Pack Format

```
packs/{pack-slug}/
  pack.yaml                              # Pack metadata
  scenarios/{scenario-slug}/{version}/
    scenario.yaml                        # Scenario def + JSON Schema inputs + runtime + execution
    templates/
      default.yaml                       # Default template
      *.yaml                             # Additional template variants
```

Templates use `{{ inputs.fieldName }}` for variable substitution. Exact placeholders preserve types; embedded placeholders coerce to string. Default merge precedence: schema defaults < template defaults < user inputs.

## Adding a New Framework

See `docs/adding-a-framework-host.md` for the step-by-step guide. Key steps:

1. Add adapter to `src/hosting/adapters/`
2. Add framework to `AgentFramework` type union
3. Register in `HostAdapterRegistry`
4. Create worker package in `agents/`
5. Create manifest in `agents/manifests/`
6. Add to agent catalog

## Code Conventions

- **Formatting:** Prettier — 120 char line width, single quotes, no trailing commas, 2-space indent
- **Linting:** ESLint flat config with TypeScript type-checked rules; `no-console` is a warning
- **Validation:** DTOs use `class-validator`/`class-transformer`; scenario inputs validated with ajv JSON Schema; agent manifests validated by `ManifestValidator` before process spawn
- **Testing:** Unit tests are co-located as `*.spec.ts` in `src/`; E2E tests are `*.e2e-spec.ts` in `test/e2e/` using supertest with fixture packs from `test/fixtures/packs/`
- **Node:** v20, TypeScript targeting ES2022, CommonJS modules, strict mode
- **CI:** GitHub Actions runs lint, build, unit tests, and E2E tests on push/PR to main
