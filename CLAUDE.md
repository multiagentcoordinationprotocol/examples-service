# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MACP Example Showcase Service — a NestJS application that combines scenario catalog, compilation, and example-agent bootstrap into a single service for demonstrating MACP concepts. It loads scenario packs from YAML files, exposes a browsable catalog API, compiles user inputs into ExecutionRequest payloads, and resolves example agent bindings.

This is intentionally a demo/showcase service, not a production system boundary.

## Commands

```bash
npm run build              # Compile TypeScript (nest build)
npm run start:dev          # Dev server with watch mode
npm run start:debug        # Debug with watch mode
npm test                   # Run unit tests (Jest, 117 tests)
npm test -- --testPathPattern=compiler  # Run a single test file by name
npm run test:e2e           # E2E tests (supertest, 13 tests)
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
- **Example Agents** (`src/example-agents/`) — Hard-coded catalog of four demo agents (fraud/LangGraph, growth/LangChain, compliance/CrewAI, risk/custom) with active process-backed hosting. Worker runtime utilities in `src/example-agents/runtime/`.
- **Hosting** (`src/hosting/`) — Two-phase hosting via `HostingService.resolve()` (pre-submission metadata) and `HostingService.attach()` (post-submission process spawning). `ProcessExampleAgentHostProvider` spawns Python/Node worker processes. `InMemoryExampleAgentHostProvider` available as a manifest-only fallback.
- **Control Plane** (`src/control-plane/`) — HTTP client for `/runs/validate` and `/runs` on the control plane.
- **Config** (`src/config/`) — `AppConfigService` is a global module wrapping environment variables including control plane settings.
- **Contracts** (`src/contracts/`) — TypeScript interfaces for registry types, launch payloads, and example agent definitions.
- **Errors** (`src/errors/`) — `AppException` with `ErrorCode` enum, `GlobalExceptionFilter`.
- **Middleware** (`src/middleware/`) — `CorrelationIdMiddleware`, `RequestLoggerMiddleware`, `ApiKeyGuard` (optional API key auth via `AUTH_API_KEYS`). Rate limiting via `@nestjs/throttler` (100 req/min default).

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

## Scenario Pack Format

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

## Code Conventions

- **Formatting:** Prettier — 120 char line width, single quotes, no trailing commas, 2-space indent
- **Linting:** ESLint flat config with TypeScript type-checked rules; `no-console` is a warning
- **Validation:** DTOs use `class-validator`/`class-transformer`; scenario inputs validated with ajv JSON Schema
- **Testing:** Unit tests are co-located as `*.spec.ts` in `src/`; E2E tests are `*.e2e-spec.ts` in `test/e2e/` using supertest with fixture packs from `test/fixtures/packs/`
- **Node:** v20, TypeScript targeting ES2022, CommonJS modules, strict mode
- **CI:** GitHub Actions runs lint, build, unit tests, and E2E tests on push/PR to main
