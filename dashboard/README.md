# LLM Guard Dashboard (Angular 21)

Standalone-component Angular 21 app with SSR, signals, and Material 3. Consumes
the LLM Guard API at `/api/v1/*`.

## Local dev

```bash
npm install
npm start                 # ng serve on http://localhost:4200
```

Set `localStorage.lg_token` to a Keycloak access token to authenticate against
the API. The dev proxy forwards `/api` to `http://localhost:8000` (the FastAPI
service from `../api`). Configure proxy in `proxy.conf.json` if needed.

## Routes

- `/overview` — KPIs, per-LLM, per-type
- `/events` — paginated event list with live toggle
- `/findings` — type × severity heatmap (stub)
- `/devices` — fleet inventory (stub)
- `/settings` — alert thresholds (stub)
