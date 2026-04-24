# LLM Guard — Infrastructure

Self-hosted single-node deployment: Postgres + TimescaleDB, Keycloak (OIDC),
Java (Spring Boot) ingest/query API, Angular 21 SSR dashboard, Caddy reverse
proxy with TLS. Presidio analyzer + anonymizer are fronted by Caddy so the
extension only ever talks HTTPS.

## Contents

- [Prerequisites](#prerequisites)
- [Quickstart (local dev, self-signed TLS)](#quickstart-local-dev-self-signed-tls)
- [First device token](#first-device-token)
- [Configuring HTTPS](#configuring-https)
- [Using real data only (purge synthetic fixtures)](#using-real-data-only-purge-synthetic-fixtures)
- [Keycloak setup](#keycloak-setup)
- [Monitoring & health checks](#monitoring--health-checks)
- [Backups & restore](#backups--restore)
- [Log files](#log-files)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Docker 24+ and docker compose plugin.
- 4 vCPU / 8 GB RAM for a small team (≤100 seats).
- 50 GB SSD. Timescale compresses older data (~500 MB per 1M events).
- No outbound network required outside image pulls.

## Quickstart (local dev, self-signed TLS)

```bash
cd infra

# 1. Generate the local CA + leaf certificate (runs OpenSSL inside Docker).
bash certs/generate-certs.sh
#   or, on Windows:
#   powershell -ExecutionPolicy Bypass -File certs\generate-certs.ps1

# 2. Trust the CA so the browser + extension accept https://localhost.
#    Windows: Import-Certificate -FilePath infra\certs\llm-guard-ca.crt -CertStoreLocation Cert:\LocalMachine\Root
#    macOS:   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain infra/certs/llm-guard-ca.crt
#    Linux:   sudo cp infra/certs/llm-guard-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates
#    See certs/README.md for details (including Firefox).

# 3. Start the stack.
docker compose up -d

# 4. Wait ≈60s on first boot, then check:
curl -k https://localhost/api/v1/health
```

The stack is then reachable at:

| URL | Service |
|-----|---------|
| `https://localhost/` | Dashboard (Angular SSR) |
| `https://localhost/api/v1/*` | Ingest + query API |
| `https://localhost/auth/` | Keycloak |
| `https://localhost/presidio/analyzer/*` | Presidio analyzer (HTTPS-terminated by Caddy) |
| `https://localhost/presidio/anonymizer/*` | Presidio anonymizer (HTTPS-terminated by Caddy) |

`http://localhost` auto-redirects to HTTPS. `llm-guard.local` also works if you
add it to your hosts file (`127.0.0.1 llm-guard.local`).

## First device token

```bash
# Load the .env
export $(grep -v '^#' infra/.env | xargs)

# Compute a device token manually (single-device dev install)
printf "%s" "my-device-1" | openssl dgst -sha256 -hmac "$DEVICE_TOKEN_SECRET" | cut -d' ' -f2
```

In the extension's **Options** page:

- **Backend URL**: `https://localhost` (the CA must be trusted — see above)
- **Device token**: the HMAC output
- **Org ID**: `default`

For production, use the admin UI (`Devices → Generate token`) once Keycloak is set up.

## Configuring HTTPS

### Local / air-gapped (self-signed CA)

Default. `certs/generate-certs.sh` issues a 10-year CA and a 2-year leaf cert
with SANs `localhost`, `127.0.0.1`, `llm-guard.local`, `*.llm-guard.local`.
Rotate by re-running the script with `--force`. Details in `certs/README.md`.

### Public deployment (automatic Let's Encrypt)

Replace the TLS-bound hostnames in `Caddyfile`:

```caddy
{
  email ops@example.com
}

https://dashboard.example.com {
  # remove the explicit `tls /certs/...` line — Caddy will ACME
  ...
}
```

Point DNS at the server, open ports 80 + 443, restart Caddy.

## Using real data only (purge synthetic fixtures)

`seed-demo.mjs` injects ~2 000 synthetic events (alice@example.fr, fake hosts,
etc.) via the public `/v1/events` endpoint. Great for demos, noisy for real
compliance reporting. To purge any previously seeded fixtures and rely solely
on telemetry posted by real extension installs:

```bash
bash infra/wipe-db.sh          # prompts for confirmation
bash infra/wipe-db.sh --yes    # non-interactive (CI)
```

This truncates `events`, `finding_counts`, `attachments`, and `devices` but
keeps the schema and user/role tables intact. The dashboard then shows empty
states until a real extension starts posting.

`seed-demo.sh` is still shipped for development. Never run it on a production
instance.

## Keycloak setup

1. Open `https://localhost/auth/admin`, log in with admin credentials from `.env`.
2. The realm `llm-guard` is auto-imported from `infra/keycloak/realm-llm-guard.json`.
3. Create your first SOC user: `Users → Add user`, set password.
4. Set the realm issuer in `docker-compose.yml` under the `api` service:

   ```yaml
   environment:
     KEYCLOAK_ISSUER: https://localhost/auth/realms/llm-guard
   ```

5. `docker compose restart api dashboard`.

## Monitoring & health checks

| Check | URL | Expected |
|-------|-----|----------|
| API liveness | `/api/v1/health` | `{"status":"ok"}` HTTP 200 |
| API metrics | `/api/actuator/prometheus` | Prometheus text format |
| Dashboard SSR | `/` | 200 + HTML shell |
| Presidio analyzer | `/presidio/analyzer/health` | 200 |
| Presidio anonymizer | `/presidio/anonymizer/health` | 200 |
| Postgres | `docker compose exec postgres pg_isready` | `accepting connections` |
| Keycloak | `/auth/health/ready` | HTTP 200 |

## Backups & restore

### Nightly logical backup

```bash
# /etc/cron.daily/llm-guard-backup
#!/usr/bin/env bash
set -euo pipefail
cd /opt/llm-guard/infra
STAMP=$(date +%F)
docker compose exec -T postgres pg_dump -U llmguard llmguard \
  | gzip > /backups/llm-guard-$STAMP.sql.gz
find /backups -name 'llm-guard-*.sql.gz' -mtime +30 -delete
```

### Restore

```bash
docker compose stop api dashboard
docker compose exec postgres psql -U llmguard -d llmguard \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c /backups/llm-guard-2026-04-15.sql.gz \
  | docker compose exec -T postgres psql -U llmguard llmguard
docker compose start api dashboard
```

## Log files

- **App log**: `docker compose logs -f api`
- **Audit log** (one line per authenticated `/v1/*` request): `docker compose logs api 2>&1 | grep " audit "`
- **Caddy access log**: `docker compose logs caddy`

Forward the audit stream to your SIEM (Loki, Elasticsearch, Splunk). It is
GDPR-required evidence that access to personal data was controlled.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ERR_CERT_AUTHORITY_INVALID` in browser | CA not trusted | Import `infra/certs/llm-guard-ca.crt` (see `certs/README.md`) |
| Extension shows "Backend injoignable" | CA not trusted by the user's OS | Same fix; Chrome follows the system root store on Win/macOS |
| `401 Missing bearer token` after enrollment | Token typo or `DEVICE_TOKEN_SECRET` rotated | Re-generate and paste again |
| `429 Too many failed auth attempts` | Rate limiter triggered (10 failures / 60s per IP) | Wait 60s, or fix the token |
| Dashboard blank, console shows 401 | Keycloak not reachable or access token expired | Re-login. Verify issuer URL matches realm |
| Presidio URL test returns `HOST_PERMISSION_MISSING` | Optional host permission not granted | Click **Tester** again in the options page |
| WebSocket drops every ~60s | Proxy idle timeout | Caddy default is 5min — check reverse proxy in front of Caddy |

## Upgrading

```bash
cd /opt/llm-guard
git pull
cd infra
docker compose pull
docker compose up -d
```

Flyway migrations are additive — back up first, always.
