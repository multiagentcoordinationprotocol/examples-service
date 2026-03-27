# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email the maintainers or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).

We aim to acknowledge reports within 48 hours and will work with you to address the issue.

## Security Considerations

This is a **demo/showcase service** and is not designed for production deployment without additional hardening:

- **API key auth** is available (`AUTH_API_KEYS`) but disabled by default. Enable it before exposing the service publicly.
- **Rate limiting** is enabled (100 req/min via `@nestjs/throttler`). Adjust for your deployment.
- **CORS** defaults to `http://localhost:3000`. Set `CORS_ORIGIN` appropriately.
- **Swagger UI** is only enabled when `NODE_ENV=development`. It is disabled in production builds.
- **No secrets are committed** — all sensitive values are loaded from environment variables.
- The service runs as a **non-root user** in Docker.

## Environment Variables With Security Impact

| Variable | Purpose | Default |
|----------|---------|---------|
| `AUTH_API_KEYS` | Comma-separated API keys for `X-Api-Key` auth | Empty (auth disabled) |
| `CONTROL_PLANE_API_KEY` | Bearer token for control plane calls | Empty |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:3000` |
| `NODE_ENV` | Controls Swagger UI visibility | `development` |
