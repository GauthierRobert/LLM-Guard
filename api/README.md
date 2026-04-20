# LLM Guard API

Self-hosted ingest + query API for the LLM Guard Chrome extension.

## Local development

```bash
uv pip install -e '.[dev]'
# Run Postgres + Timescale via infra/docker-compose.yml first
DATABASE_URL=postgresql+asyncpg://llmguard:llmguard@localhost:5432/llmguard \
  alembic upgrade head
uvicorn llm_guard_api.main:app --reload
```

## Endpoints

- `POST /v1/events` — device-authenticated batch ingest (up to 500 events/req).
- `GET  /v1/stats?range=24h` — user-authenticated aggregates.
- `GET  /v1/events?...filters` — paginated event list.
- `WS   /v1/live?org=<id>` — realtime event stream.
- `GET  /v1/health` — liveness probe.

## Tests

```bash
pytest api/tests
```
