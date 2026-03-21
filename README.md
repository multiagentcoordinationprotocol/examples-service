# MACP Scenario Registry

File-backed scenario catalog and compiler for the [Multi-Agent Coordination Protocol](https://github.com/multiagentcoordinationprotocol).

Loads scenario packs from YAML files on disk, exposes them as a browsable catalog, and compiles user inputs into `ExecutionRequest` payloads for the [control plane](../control-plane/).

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

# Get launch schema
curl http://localhost:3000/packs/fraud/scenarios/high-value-new-device/versions/1.0.0/launch-schema?template=default

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
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/packs` | List all available scenario packs |
| GET | `/packs/:packSlug/scenarios` | List scenarios in a pack with versions and templates |
| GET | `/packs/:packSlug/scenarios/:scenarioSlug/versions/:version/launch-schema` | Get form schema and defaults |
| POST | `/launch/compile` | Validate and compile inputs into an ExecutionRequest |
| GET | `/healthz` | Liveness probe |
| GET | `/docs` | Swagger UI (development only) |

## Creating a Scenario Pack

Packs live in the `packs/` directory:

```
packs/
  {pack-slug}/
    pack.yaml                          # Pack metadata
    scenarios/
      {scenario-slug}/
        {version}/
          scenario.yaml                # Scenario definition + input schema
          templates/
            default.yaml               # Default template with preset inputs
            custom.yaml                # Additional templates
```

### pack.yaml

```yaml
apiVersion: scenarios.macp.dev/v1
kind: ScenarioPack
metadata:
  slug: my-pack
  name: My Pack
  description: Description of the pack
  tags: [tag1, tag2]
```

### scenario.yaml

Defines the input schema (JSON Schema), launch configuration, participants, and templates for context/metadata/kickoff.

### template.yaml

Provides default input values and optional launch overrides (e.g., different TTL, metadata).

See `packs/fraud/` for a complete working example.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP port |
| `PACKS_DIR` | ./packs | Path to pack YAML files |
| `REGISTRY_CACHE_TTL_MS` | 0 | Cache TTL (0 = reload every request) |
| `NODE_ENV` | development | Set to enable Swagger at /docs |
| `CORS_ORIGIN` | http://localhost:3000 | CORS origin |

## Development

```bash
npm run build          # Compile TypeScript
npm run start:dev      # Dev mode with auto-reload
npm test               # Unit tests
npm run test:cov       # Coverage report
npm run test:e2e       # E2E tests
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
