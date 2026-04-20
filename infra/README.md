# LLM Guard — Infrastructure

Self-hosted single-node deployment: Postgres + TimescaleDB, Keycloak (OIDC),
Java (Spring Boot) ingest/query API, Angular 21 SSR dashboard, Caddy reverse
proxy with automatic TLS.

## Contents

- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [First device token](#first-device-token)
- [Configuring HTTPS](#configuring-https)
- [Keycloak setup](#keycloak-setup)
- [Monitoring & health checks](#monitoring--health-checks)
- [Backups & restore](#backups--restore)
- [Log files](#log-files)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Linux host (tested on Ubuntu 22.04, Debian 12, RHEL 9) with:
  - Docker 24+ and docker compose plugin
  - 4 vCPU / 8 GB RAM for a small team (≤100 seats); scale up linearly per ~500 seats
  - 50 GB SSD (Timescale compresses older data; plan ~500 MB per 1M events)
- Outbound network only required to pull container images (air-gapped installs:
  mirror images to your registry, set `image:` fields accordingly).
- DNS A/AAAA record pointing at the server for the public dashboard hostname.
- Port 80 + 443 reachable from the internet **only if** you use Caddy's
  automatic Let's Encrypt TLS. Otherwise see [Configuring HTTPS](#configuring-https).

## Quickstart

```bash
# 1. Clone + enter the repo
git clone https://github.com/GauthierRobert/llm-guard.git
cd llm-guard/infra

# 2. Generate secrets (keep them safe — losing DEVICE_TOKEN_SECRET invalidates all enrolled devices)
cat > .env <<EOF
DEVICE_TOKEN_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -hex 24)
APP_HOSTNAME=dashboard.example.com
EOF
chmod 600 .env

# 3. Point DNS at this server (A record for $APP_HOSTNAME)

# 4. Edit Caddyfile — replace dashboard.example.com with $APP_HOSTNAME
sed -i "s/dashboard\\.example\\.com/$APP_HOSTNAME/g" Caddyfile

# 5. Start everything
docker compose up -d

# 6. Wait for all services (≈60s on first boot). Check health:
docker compose ps
curl -sf https://$APP_HOSTNAME/api/v1/health && echo OK
```

## First device token

The extension authenticates each ingest POST with a bearer token that is an
HMAC-SHA256 of a per-device secret. Tokens are generated from the admin UI
once Keycloak is configured. Short path for a dev box without Keycloak:

```bash
# Compute a token manually (single-device install). Copy the output.
printf "%s" "my-device-1" | openssl dgst -sha256 -hmac "$DEVICE_TOKEN_SECRET" | cut -d' ' -f2
```

Paste the output into the Chrome extension's **Options → Jeton de l'appareil**
field along with the backend URL `https://$APP_HOSTNAME/api`.

For production: enable the admin UI (`dashboard → Devices → Generate token`)
after Keycloak is set up.

## Configuring HTTPS

### Automatic (public server)

Caddy will obtain a free Let's Encrypt certificate for `$APP_HOSTNAME` on
first start, as long as ports 80 and 443 are publicly reachable and DNS
resolves. Nothing else to do.

### Manual certificate (internal CA, air-gapped)

1. Place your certificate (`dashboard.crt`) and key (`dashboard.key`) in
   `infra/certs/`.
2. Replace the `tls` block in `Caddyfile`:

   ```caddy
   dashboard.example.com {
     tls /certs/dashboard.crt /certs/dashboard.key
     # ...
   }
   ```

3. Mount the certs directory in `docker-compose.yml`:

   ```yaml
   caddy:
     volumes:
       - ./certs:/certs:ro
       # existing volumes…
   ```

4. `docker compose restart caddy`.

### Plain HTTP for dev

Use `Caddyfile.dev` (bind `:80` without TLS). The extension's options page
blocks plaintext unless the host matches `localhost` / `127.x.x.x` / private
IPv4 ranges — intentional to prevent accidental prod misconfigurations.

## Keycloak setup

1. Open `https://$APP_HOSTNAME/auth/admin`, log in with the admin credentials
   from `.env`.
2. Import the starter realm from `infra/keycloak/realm-llmguard.json`:
   - `Realm settings → Partial import → Upload JSON`.
3. Create your first SOC user: `Users → Add user`, set password.
4. Note the realm issuer URL (shown on the realm home page) and set it in
   `docker-compose.yml` under the `api` service:

   ```yaml
   environment:
     SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI: https://.../auth/realms/llmguard
   ```

5. `docker compose restart api dashboard`.

## Monitoring & health checks

| Check | URL | Expected |
|-------|-----|----------|
| API liveness | `/api/v1/health` | `{"status":"ok"}` HTTP 200 |
| API metrics | `/api/actuator/prometheus` | Prometheus text format |
| Dashboard SSR | `/` | 200 + HTML shell |
| Postgres | `docker compose exec postgres pg_isready` | `accepting connections` |
| Keycloak | `/auth/health/ready` | HTTP 200 |

Scrape `/api/actuator/prometheus` with Prometheus / Grafana Agent — the app
exposes JVM, HikariCP, HTTP, and custom counters (`llm_guard_events_ingested_total`,
`llm_guard_auth_failures_total`).

## Backups & restore

### Nightly logical backup (recommended)

```bash
# /etc/cron.daily/llm-guard-backup
#!/usr/bin/env bash
set -euo pipefail
cd /opt/llm-guard/infra
STAMP=$(date +%F)
docker compose exec -T postgres pg_dump -U llmguard llmguard \
  | gzip > /backups/llm-guard-$STAMP.sql.gz
# Retention: 30 days
find /backups -name 'llm-guard-*.sql.gz' -mtime +30 -delete
```

Copy `/backups` off-host nightly (rsync, S3, Restic). Backup also includes
Keycloak's realm if you use the same Postgres instance; otherwise dump
`keycloak` DB separately.

### Restore

```bash
# Stop the API so writes pause during restore
docker compose stop api dashboard

# Drop + recreate schema
docker compose exec postgres psql -U llmguard -d llmguard \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Load
gunzip -c /backups/llm-guard-2026-04-15.sql.gz \
  | docker compose exec -T postgres psql -U llmguard llmguard

docker compose start api dashboard
```

## Log files

- **App log** (INFO, WARN, ERROR): `docker compose logs -f api`
- **Audit log** (one line per authenticated /v1/* request): filter by logger
  `audit`:
  ```bash
  docker compose logs api 2>&1 | grep " audit "
  ```
  The audit stream is GDPR-required evidence that access to personal data
  was controlled. Forward it to your SIEM (Loki, Elasticsearch, Splunk).
- **Caddy access log**: `docker compose logs caddy`

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Extension shows "Backend injoignable" | DNS / firewall / Caddy TLS | `curl -v https://$APP_HOSTNAME/api/v1/health` from the user's LAN |
| `401 Missing bearer token` after enrollment | Token typo or DEVICE_TOKEN_SECRET rotated | Re-generate and paste again |
| `429 Too many failed auth attempts` | Rate limiter triggered (10 failures / 60s per IP) | Wait 60s, or fix the token |
| Dashboard blank, console shows 401 | Keycloak not reachable or access token expired | Re-login. Verify issuer URL matches realm |
| `pg_isready` fails | Disk full | `df -h`, truncate old logs, extend volume |
| WebSocket drops every ~60s | Proxy idle timeout | Caddy default is 5min — check reverse proxy in front of Caddy |

## Upgrading

```bash
cd /opt/llm-guard
git pull
cd infra
docker compose pull           # fetch new images
docker compose up -d           # zero-downtime-ish: Caddy holds the socket
docker compose exec api java -jar app.jar --spring.flyway.repair  # if Flyway flagged a checksum
```

Flyway migrations are additive — backup first, always.
