# LLM Guard API (Java / Spring Boot)

Self-hosted ingest + query API for the LLM Guard Chrome extension, rewritten
on Java 25 + Spring Boot 4 (Spring Framework 7, Jakarta EE 11, Hibernate 7).

## Stack

| Concern        | Choice                                                |
| -------------- | ----------------------------------------------------- |
| Language       | Java 25 (virtual threads enabled)                     |
| Framework      | Spring Boot 4.0 / Spring Framework 7                  |
| Persistence    | Spring Data JPA + Hibernate 7 (JSONB via Hypersistence)|
| Migrations     | Flyway (`db/migration/V1__initial.sql`)              |
| Database       | Postgres 16 + TimescaleDB                             |
| Auth (ingest)  | Bearer device token (HMAC-SHA256)                     |
| Auth (query)   | Keycloak OIDC (Spring Security resource server)       |
| Realtime       | Spring WebSocket (`/v1/live`)                         |
| Build          | Gradle Kotlin DSL                                     |

## Endpoints

| Method | Path                    | Auth              | Notes                         |
| ------ | ----------------------- | ----------------- | ----------------------------- |
| GET    | `/v1/health`            | public            | liveness                      |
| POST   | `/v1/events`            | Device token      | batch ingest (1..500 events)  |
| GET    | `/v1/stats?range=24h`   | Keycloak JWT      | aggregates                    |
| GET    | `/v1/events?...`        | Keycloak JWT      | paginated list                |
| WS     | `/v1/live?org=<id>`     | (dev: open)       | realtime fan-out              |

The wire contract is `shared/schema.json`; DTOs live in `api/dto/` and reject
unknown fields (matches the Python `extra="forbid"` behavior).

## Local dev

```bash
# Start Postgres via infra/docker-compose.yml, then:
./gradlew bootRun
# or, inside the monorepo root:
docker compose -f infra/docker-compose.yml up --build api
```

Tests (unit validation only — no DB spin-up):

```bash
./gradlew test
```

## Config (env vars)

| Variable               | Default                                             |
| ---------------------- | --------------------------------------------------- |
| `DATABASE_URL`         | `jdbc:postgresql://postgres:5432/llmguard`         |
| `DATABASE_USER`        | `llmguard`                                          |
| `DATABASE_PASSWORD`    | `llmguard`                                          |
| `ORG_ID`               | `default`                                           |
| `DEVICE_TOKEN_SECRET`  | `change-me-in-prod`                                 |
| `KEYCLOAK_ISSUER`      | *(empty — JWT disabled in dev)*                     |
| `KEYCLOAK_AUDIENCE`    | `llm-guard-dashboard`                               |
| `CORS_ORIGINS`         | `http://localhost:4200`                             |

Flyway runs at startup; no manual migration step needed.
