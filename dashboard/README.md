# LLM Guard Dashboard (Angular 21)

Standalone-component Angular 21 app with SSR, signals, and Material 3. Consumes
the LLM Guard API at `/api/v1/*`.

## Local dev

```bash
npm install
npm start                 # ng serve on http://localhost:4200
```

Set `localStorage.lg_token` to a Keycloak access token to authenticate against
the API. The dev proxy forwards `/api` to `http://localhost:8000` (the Java
service from `../api-java`). Configure proxy in `proxy.conf.json` if needed.

## Routes

- `/overview` — KPIs, per-LLM, per-type, compliance score, breach countdown
- `/events` — paginated event list with live toggle
- `/findings` — type × severity with GDPR/AI Act cross-references
- `/compliance` — article explorer (GDPR + EU AI Act)
- `/dpia` — DPIA / RoPA generator
- `/risk-tiers` — EU AI Act tier assignment per LLM
- `/transfers` — chapter V transfers map
- `/devices` — fleet inventory with revoke action
- `/settings` — alert thresholds (stub)

## Getting live data into the dashboard

Fresh installs start with an empty database and the dashboard will show an
empty-state banner on every view. Two complementary ways to populate it:

### Option A — seed realistic fixtures (instant)

With the stack running via `infra/docker-compose.yml`:

```bash
bash infra/seed-demo.sh            # or: node infra/seed-demo.mjs
```

Posts ~2000 synthetic events over the last 30 days across six synthetic devices
through the real `/v1/events` ingest path, so Timescale aggregates and the
WebSocket broadcast both behave exactly as they do in production. Tunable via
env vars: `BASE_URL`, `ORG`, `TOTAL`, `BATCH_SIZE`, `TOKEN`.

### Option B — connect the real Chrome extension

1. Load the unpacked extension (`Load unpacked` in `chrome://extensions/`
   pointed at the repo root).
2. Open `chrome-extension://<extension-id>/options.html`.
3. Set:
   - **Enabled:** on
   - **Backend URL:** `http://localhost` (Caddy proxies `/api/*` to the Java API)
   - **Org ID:** `default` (any id works — new orgs auto-register on first event)
   - **Device token:** any long random string. The backend accepts any
     non-empty bearer and HMACs it; the `devices` row is created on first
     telemetry via an upsert in `IngestController`.
4. Click **Save**, then **Test connection** — should return `200`.
5. Use ChatGPT / Claude / Gemini. Events flush to the backend every ~60s via
   `chrome.alarms`. The Devices page will show your browser under the
   userHint / email you configured.

### Verifying the flow

- `curl http://localhost/api/v1/health` → `{ "status": "ok" }`
- `curl http://localhost/api/v1/stats?range=24h` → aggregated counts (needs JWT
  only when `KEYCLOAK_ISSUER` is set in `docker-compose.yml`, otherwise open)
- Dashboard at `http://localhost` shows non-zero tiles within seconds of a
  successful ingest.
