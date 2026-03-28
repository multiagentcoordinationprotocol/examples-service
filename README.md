# MACP Example Showcase Service

File-backed example showcase service for [Multi-Agent Coordination Protocol](https://github.com/multiagentcoordinationprotocol) demos, combining scenario catalog, compilation, and example-agent bootstrap in a single service.

> This service is a showcase/examples layer used to demonstrate scenarios and sample agents for MACP. It intentionally combines catalog, compilation, and sample agent hosting for simplicity. It is not the production system boundary.

## Quick Start

```bash
npm install
npm run start:dev
```

The server starts on `http://localhost:3000`. Swagger docs are available at `/docs` in development mode.

### Try it

```bash
# List packs
curl http://localhost:3000/packs

# List scenarios in a pack
curl http://localhost:3000/packs/fraud/scenarios

# Get launch schema with agent previews
curl http://localhost:3000/packs/fraud/scenarios/high-value-new-device/versions/1.0.0/launch-schema

# Compile an execution request
curl -X POST http://localhost:3000/launch/compile \
  -H 'Content-Type: application/json' \
  -d '{
    "scenarioRef": "fraud/high-value-new-device@1.0.0",
    "templateId": "default",
    "mode": "sandbox",
    "inputs": {
      "transactionAmount": 3200,
      "deviceTrustScore": 0.12,
      "accountAgeDays": 5,
      "isVipCustomer": true,
      "priorChargebacks": 1
    }
  }'

# Run a full example (compile + bootstrap agents, skip control plane)
curl -X POST http://localhost:3000/examples/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scenarioRef": "fraud/high-value-new-device@1.0.0",
    "templateId": "strict-risk",
    "submitToControlPlane": false,
    "inputs": {
      "transactionAmount": 3200,
      "deviceTrustScore": 0.12,
      "accountAgeDays": 5,
      "isVipCustomer": true,
      "priorChargebacks": 1
    }
  }'
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Liveness probe |
| GET | `/packs` | List all available scenario packs |
| GET | `/packs/:packSlug/scenarios` | List scenarios with versions, templates, and agent refs |
| GET | `/packs/:packSlug/scenarios/:scenarioSlug/versions/:version/launch-schema` | Get form schema, defaults, and agent previews |
| POST | `/launch/compile` | Validate and compile inputs into an ExecutionRequest |
| POST | `/examples/run` | Compile + bootstrap agents + optionally submit to control plane |
| GET | `/docs` | Swagger UI (development only) |

See [docs/api-reference.md](docs/api-reference.md) for full request/response details.

## Architecture

The service combines three concerns for demo simplicity:

- **Catalog** — browse packs and scenarios from YAML files on disk
- **Compiler** — validate inputs (AJV JSON Schema) and compile `ExecutionRequest` payloads with `{{ inputs.* }}` template substitution
- **Hosting** — resolve example agents (fraud, growth, risk) and inject transport identities

See [docs/architecture.md](docs/architecture.md) for the full module structure and data flow.

## Example Agents

Four demo agents are included:

| Agent | Framework | Role |
|-------|-----------|------|
| Fraud Agent | LangGraph | Evaluates device, chargeback, and identity-risk signals |
| Growth Agent | LangChain | Assesses customer value and revenue impact |
| Compliance Agent | CrewAI | Applies KYC/AML policy checks |
| Risk Agent | Custom | Coordinates the final recommendation |

All agents use an **active process-backed** hosting strategy. Python and Node.js worker processes are spawned after the control plane creates a run, poll for events, and send MACP messages back through the control plane. Transport identities and entrypoints are resolved and injected into the ExecutionRequest before submission.

## Creating Scenario Packs

See [docs/scenario-authoring.md](docs/scenario-authoring.md) for the full authoring guide.

```
packs/{pack-slug}/
  pack.yaml
  scenarios/{scenario-slug}/{version}/
    scenario.yaml
    templates/
      default.yaml
      *.yaml
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP port |
| `PACKS_DIR` | ./packs | Path to pack YAML files |
| `REGISTRY_CACHE_TTL_MS` | 0 | Cache TTL (0 = reload every request) |
| `CONTROL_PLANE_BASE_URL` | http://localhost:3001 | Control plane endpoint |
| `CONTROL_PLANE_API_KEY` | (empty) | Bearer token for control plane |
| `AUTO_BOOTSTRAP_EXAMPLE_AGENTS` | true | Auto-bootstrap agents on /examples/run |
| `NODE_ENV` | development | Set to enable Swagger at /docs |
| `CORS_ORIGIN` | http://localhost:3000 | Comma-separated origins (supports `*` wildcards) |
| `AUTH_API_KEYS` | (empty) | Comma-separated API keys for `X-Api-Key` auth (empty = disabled) |

## Deployment

This backend is designed to run alongside a Vercel-hosted frontend.

```
┌─────────────┐         ┌──────────────────────┐
│  Vercel      │  HTTPS  │  Railway / Render     │
│  (UI)        │────────▶│  (examples-service)   │
└─────────────┘         └──────────────────────┘
```

### Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template)

1. Connect your GitHub repo
2. Railway auto-detects the `Dockerfile`
3. Set environment variables:

```
NODE_ENV=production
CORS_ORIGIN=https://your-app.vercel.app,https://your-app-*.vercel.app
AUTH_API_KEYS=<generate-a-secret-key>
REGISTRY_CACHE_TTL_MS=60000
```

### Deploy to Render

1. Create a new **Web Service** from your GitHub repo
2. Set **Build Command** to `docker` (auto-detects Dockerfile)
3. Set the same environment variables as above

### Frontend (Vercel) setup

Set one env var in your Vercel project:

```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
```

### CORS for Vercel preview URLs

Vercel generates unique URLs per PR (e.g. `myapp-git-branch-name.vercel.app`). Use wildcards:

```
CORS_ORIGIN=https://your-app.vercel.app,https://your-app-*.vercel.app
```

## Development

```bash
npm run build          # Compile TypeScript
npm run start:dev      # Dev mode with auto-reload
npm test               # Unit tests
npm run test:e2e       # E2E tests
npm run test:cov       # Coverage report
npm run lint           # ESLint
npm run format         # Prettier
```

## Docker

```bash
docker compose up                                                      # Production
docker compose -f docker-compose.yml -f docker-compose.dev.yml up      # Development
```

## License

Apache-2.0
