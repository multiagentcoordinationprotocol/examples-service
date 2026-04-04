# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MACP Example Showcase Service — a NestJS application that combines scenario catalog, compilation, and example-agent bootstrap into a single service for demonstrating MACP concepts. It loads scenario packs from YAML files, exposes a browsable catalog API, compiles user inputs into ExecutionRequest payloads, and resolves example agent bindings.

The service features a **framework-neutral hosting architecture** that launches real framework-backed agents (LangGraph, LangChain, CrewAI, custom) that all communicate through the same MACP control-plane contract.

This is intentionally a demo/showcase service, not a production system boundary. The primary consumer is the **UI Console** (`ui-console/`), which proxies requests through a Next.js API route.

## Commands

```bash
npm run build              # Compile TypeScript (nest build)
npm run start:dev          # Dev server with watch mode
npm run start:debug        # Debug with watch mode
npm run lint               # ESLint check
npm run lint:fix           # ESLint auto-fix
npm run format             # Prettier formatting
```

### Testing

```bash
npm test                                    # Unit tests (Jest, 205 tests across 27 spec files)
npm test -- --testPathPattern=compiler      # Run a single test file by name
npm run test:e2e                            # E2E tests (supertest, 31 tests)
npm run test:integration                    # Integration tests with mock control plane (60 tests)
npm run test:integration:docker             # Integration tests against Docker control plane
npm run test:integration:remote             # Integration tests against remote control plane
```

**Three test tiers:**

| Tier | Location | Pattern | Runner | What it tests |
|------|----------|---------|--------|---------------|
| Unit | `src/**/*.spec.ts` | co-located | `jest` | Individual services/controllers with mocked deps |
| E2E | `test/e2e/*.e2e-spec.ts` | `jest --config test/jest-e2e.config.ts` | supertest | Full NestJS app with fixture packs, mocked `AppConfigService` |
| Integration | `test/integration/*.integration.spec.ts` | `jest --config test/jest.integration.config.ts --runInBand` | raw HTTP client | Full app with mock/real control plane via `INTEGRATION_CONTROL_PLANE` env var |

**Integration test modes** (controlled by `INTEGRATION_CONTROL_PLANE`):
- `mock` (default) — in-process HTTP server mimics `/runs/validate` and `/runs`; supports configurable failure modes for error-path testing
- `docker` — expects a real control plane at `CONTROL_PLANE_BASE_URL`
- `remote` — same as docker, for staging/prod-like environments

**Integration test infrastructure** (`test/helpers/`):
- `mock-control-plane.ts` — `MockControlPlane` class with `setValidateFailure()`/`setCreateRunFailure()`, request recording, bearer token validation
- `integration-test-app.ts` — `createIntegrationTestApp()` factory returns `IntegrationTestContext { app, client, mockControlPlane, controlPlaneMode }`
- `integration-test-client.ts` — `IntegrationTestClient` with typed methods for all service endpoints

**Test fixtures:** `test/fixtures/packs/` contains fraud, lending, claims, and empty-pack fixture packs. `test/fixtures/integration-requests.ts` has request factory functions for all three scenarios.

### Docker

`docker compose -f docker-compose.dev.yml up` for local dev with hot reload.

## Architecture

**Request flow:** HTTP → CorrelationIdMiddleware → RequestLoggerMiddleware → Controller → Service → Response (GlobalExceptionFilter catches errors)

**Key modules:**

- **Registry** (`src/registry/`) — `FileRegistryLoader` discovers and parses YAML pack files from `PACKS_DIR`. `RegistryIndexService` caches the loaded index with configurable TTL (`REGISTRY_CACHE_TTL_MS`, 0 = reload every request).
- **Catalog** (`src/catalog/`) — Read-only endpoints to browse packs and scenarios. `CatalogService` lists packs and scenarios (per-pack and cross-pack). `AgentProfileService` builds agent profiles by cross-referencing the agent catalog with the registry to compute scenario coverage.
- **Compiler** (`src/compiler/`) — `CompilerService` validates inputs against JSON Schema (ajv), `template-resolver` handles `{{ inputs.* }}` substitution, default merging (`deepMerge`), and `parseScenarioRef`.
- **Launch** (`src/launch/`) — `LaunchService` generates launch schemas with agent previews. `ExampleRunService` orchestrates the full showcase flow (compile → apply overrides → resolve agents → submit → attach workers). Supports optional `tags`, `requester`, and `runLabel` fields for UI-driven launches.
- **Example Agents** (`src/example-agents/`) — `ExampleAgentCatalogService` holds four demo agent definitions (fraud/LangGraph, growth/LangChain, compliance/CrewAI, risk/custom) with manifest-driven configs. Worker runtime utilities in `src/example-agents/runtime/`.
- **Hosting** (`src/hosting/`) — Framework-neutral hosting via adapter pattern. `HostAdapterRegistry` maps framework → adapter. `ManifestValidator` validates before spawn. `LaunchSupervisor` manages process lifecycle. `ProcessExampleAgentHostProvider` orchestrates resolve/attach. See `docs/framework-hosting-design.md` for full details.
  - **Adapters** (`src/hosting/adapters/`) — `LangGraphHostAdapter`, `LangChainHostAdapter`, `CrewAIHostAdapter`, `CustomHostAdapter`.
  - **Contracts** (`src/hosting/contracts/`) — `AgentManifest`, `BootstrapPayload`, `AgentHostAdapter` interfaces.
- **Control Plane** (`src/control-plane/`) — `ControlPlaneClient` HTTP client for `/runs/validate` and `/runs` on the control plane.
- **Config** (`src/config/`) — `AppConfigService` is a global module wrapping environment variables including control plane settings.
- **Contracts** (`src/contracts/`) — TypeScript interfaces for registry types (`PackSummary`, `ScenarioSummary`, `ParticipantTemplate`), launch payloads (`ExecutionRequest`, `CompileLaunchResult`, `RunExampleResult`), and example agent definitions (`ExampleAgentDefinition`, `HostedExampleAgent`).
- **Errors** (`src/errors/`) — `AppException` with `ErrorCode` enum, `GlobalExceptionFilter`.
- **Middleware** (`src/middleware/`) — `CorrelationIdMiddleware`, `RequestLoggerMiddleware`, `ApiKeyGuard` (optional API key auth via `AUTH_API_KEYS` and `x-api-key` header). Rate limiting via `@nestjs/throttler` (100 req/min default).

**Framework Workers** (`agents/`):

- `agents/langgraph_worker/` — Real LangGraph graph for fraud detection (falls back without langgraph installed)
- `agents/langchain_worker/` — Real LangChain chain for growth analysis (falls back without langchain installed)
- `agents/crewai_worker/` — Real CrewAI crew for compliance review (falls back without crewai installed)
- `agents/sdk/python/macp_worker_sdk/` — Shared Python SDK (bootstrap, control plane client, message builder)
- `agents/sdk/node/` — Shared Node SDK (same contract)
- `agents/manifests/` — JSON manifest files defining each agent's framework config
- `agents/python/` — Legacy shim workers (preserved for backward compatibility)

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | Liveness probe |
| GET | `/packs` | List all scenario packs |
| GET | `/packs/:packSlug/scenarios` | List scenarios in a pack with versions, templates, agent refs |
| GET | `/scenarios` | List all scenarios across all packs (each includes `packSlug`) |
| GET | `/packs/:packSlug/scenarios/:scenarioSlug/versions/:version/launch-schema` | Get form schema, defaults, agent previews. Optional `?template=` query param. |
| GET | `/agents` | List agent profiles with scenario coverage and metrics |
| GET | `/agents/:agentRef` | Get single agent profile by ref |
| POST | `/launch/compile` | Validate inputs & compile into ExecutionRequest |
| POST | `/examples/run` | Full showcase: compile + bootstrap agents + optionally submit to control plane. Accepts optional `tags`, `requester`, `runLabel`. |
| GET | `/docs` | Swagger UI (dev only, when NODE_ENV=development) |

**Authentication:** Optional API key via `x-api-key` header. Enabled when `AUTH_API_KEYS` is set (comma-separated list). Empty = auth disabled.

**Error codes** (returned in `errorCode` field):

| Code | HTTP Status | When |
|------|-------------|------|
| `PACK_NOT_FOUND` | 404 | Pack slug doesn't exist |
| `SCENARIO_NOT_FOUND` | 404 | Scenario slug doesn't exist in pack |
| `VERSION_NOT_FOUND` | 404 | Version doesn't exist for scenario |
| `TEMPLATE_NOT_FOUND` | 404 | Template slug doesn't exist for version |
| `AGENT_NOT_FOUND` | 404 | Agent ref not in catalog |
| `INVALID_SCENARIO_REF` | 400 | scenarioRef not in `pack/scenario@version` format |
| `INVALID_PACK_DATA` | 400 | Malformed YAML pack data |
| `VALIDATION_ERROR` | 400 | User inputs fail JSON Schema validation |
| `COMPILATION_ERROR` | 400 | Template substitution failure |
| `CONTROL_PLANE_UNAVAILABLE` | 502 | Control plane request failed or timed out |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen host |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origins (comma-separated) |
| `PACKS_DIR` | `./packs` | Disk path to scenario pack YAML files |
| `REGISTRY_CACHE_TTL_MS` | `0` | Registry cache TTL; 0 = reload every request |
| `CONTROL_PLANE_BASE_URL` | `http://localhost:3001` | Control plane HTTP base URL |
| `CONTROL_PLANE_API_KEY` | _(empty)_ | Bearer token for control plane requests |
| `CONTROL_PLANE_TIMEOUT_MS` | `10000` | Control plane request timeout |
| `AUTO_BOOTSTRAP_EXAMPLE_AGENTS` | `true` | Auto-resolve agent bindings on `/examples/run` |
| `EXAMPLE_AGENT_PYTHON_PATH` | `python3` | Python interpreter for agent workers |
| `EXAMPLE_AGENT_NODE_PATH` | _(process.execPath)_ | Node interpreter for agent workers |
| `AUTH_API_KEYS` | _(empty)_ | Comma-separated API keys; empty = auth disabled |
| `LOG_LEVEL` | `info` | Logging level |
| `NODE_ENV` | `development` | Environment; `development` enables Swagger UI |

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

- **Formatting:** Prettier — 120 char line width, single quotes, no trailing commas, 2-space indent, semicolons
- **Linting:** ESLint flat config (`eslint.config.mjs`) with TypeScript type-checked rules; `no-console` is a warning
- **Validation:** DTOs use `class-validator`/`class-transformer`; scenario inputs validated with ajv JSON Schema; agent manifests validated by `ManifestValidator` before process spawn
- **Testing:** Unit tests co-located as `*.spec.ts` in `src/`; E2E tests as `*.e2e-spec.ts` in `test/e2e/`; integration tests as `*.integration.spec.ts` in `test/integration/`. Fixture packs in `test/fixtures/packs/`.
- **Node:** v20, TypeScript targeting ES2022, CommonJS modules, strict mode
- **CI:** GitHub Actions runs lint, build, unit tests, and E2E tests on push/PR to main
