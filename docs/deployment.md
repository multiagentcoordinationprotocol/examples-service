# Deployment

## Principle

The repo is **fully platform-agnostic**. The `Dockerfile` is the only deployment contract — no platform-specific config files in the repo. All platform settings live in each platform's dashboard.

## Pipeline

```
push to main / PR
  │
  ├─ lint          ESLint
  ├─ build         TypeScript compile
  ├─ test          unit tests + e2e tests + Python validation
  │
  └─ docker        Build image → push to GHCR
                     main  → :latest + :sha-<commit>
                     PR    → :pr-<number>
```

## Image Tags

| Trigger | Tag | Purpose |
|---------|-----|---------|
| Push to `main` | `:latest` | Rolling production tag |
| Push to `main` | `:sha-<commit>` | Immutable, for rollback |
| Pull request | `:pr-<number>` | Preview / validation |

Images live at:
```
ghcr.io/multiagentcoordinationprotocol/examples-service
```

## Deploying

Point any container platform at the GHCR image. No platform config files needed — configure everything in the platform's dashboard.

### Railway

1. Create a service → set source to **Docker Image**
2. Image: `ghcr.io/multiagentcoordinationprotocol/examples-service:latest`
3. Set env vars in the Variables tab

### Render

1. Create a Web Service → type **Docker Image**
2. Image: `ghcr.io/multiagentcoordinationprotocol/examples-service:latest`
3. Set env vars in the Environment tab

### Fly.io

```bash
flyctl apps create macp-example-service
flyctl deploy --image ghcr.io/multiagentcoordinationprotocol/examples-service:latest
flyctl secrets set CONTROL_PLANE_BASE_URL=https://...
```

### AWS ECS

1. Create an ECR repo, push the GHCR image (or point the task definition at GHCR directly)
2. Create ECS cluster + service + task definition referencing the image

### Any other platform

Any platform that can run a Docker image works. Point it at:
```
ghcr.io/multiagentcoordinationprotocol/examples-service:latest
```

## PR Preview Environments

PR builds produce images tagged `:pr-<number>`. Platforms that support preview environments can pull these for ephemeral deployments:

```
ghcr.io/multiagentcoordinationprotocol/examples-service:pr-42
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | Yes | `3000` | HTTP listen port |
| `NODE_ENV` | Yes | `production` | |
| `PACKS_DIR` | Yes | `/app/packs` | Scenario packs path |
| `CONTROL_PLANE_BASE_URL` | Yes | — | Control plane URL |
| `CONTROL_PLANE_API_KEY` | No | — | Bearer token |
| `CONTROL_PLANE_TIMEOUT_MS` | No | `10000` | |
| `AUTO_BOOTSTRAP_EXAMPLE_AGENTS` | No | `true` | |
| `AUTH_API_KEYS` | No | — | Comma-separated |
| `LOG_LEVEL` | No | `info` | |

## GHCR Visibility

If the package is private, set it to **Public** (simplest), or configure pull credentials in your platform's dashboard.

## Rollback

```bash
# Use an older immutable tag
ghcr.io/multiagentcoordinationprotocol/examples-service:sha-abc1234
```

Or re-tag:
```bash
docker pull ghcr.io/…/examples-service:sha-<old>
docker tag  ghcr.io/…/examples-service:sha-<old> ghcr.io/…/examples-service:latest
docker push ghcr.io/…/examples-service:latest
```

## Local Testing

```bash
docker build -t examples-service .
docker run -p 3000:3000 -e NODE_ENV=development examples-service
curl http://localhost:3000/healthz
```
