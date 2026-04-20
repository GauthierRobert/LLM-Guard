# LLM Guard — Infrastructure

Self-hosted single-node deployment: Postgres + TimescaleDB, Keycloak (OIDC),
Java (Spring Boot) ingest/query API, Angular 21 SSR dashboard, Caddy reverse
proxy with automatic TLS.

## Quickstart

```bash
# 1. Generate a device-token secret
export DEVICE_TOKEN_SECRET=$(openssl rand -hex 32)

# 2. Edit Caddyfile: replace dashboard.example.com with your domain
# 3. Point DNS A record → this server
# 4. Start everything
docker compose up -d

# 5. Create a device token (manual for now, admin UI coming in phase 5):
#    - Open http://localhost:8000/docs
#    - POST /v1/devices (admin auth required)
#    - Copy the returned token into the extension's Options page
```

## Components

| Service    | Port | Role |
|------------|------|------|
| postgres   | —    | TimescaleDB hypertable for events |
| keycloak   | 8080 | OIDC for SOC user login |
| api        | 8000 | Java (Spring Boot) ingest + query |
| dashboard  | 4000 | Angular 21 SSR |
| caddy      | 80/443 | Reverse proxy + TLS |

## Backups

```bash
# Nightly pg_dump to S3-compatible storage
docker compose exec postgres pg_dump -U llmguard llmguard | gzip > backup-$(date +%F).sql.gz
```
