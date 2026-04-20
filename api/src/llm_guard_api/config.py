"""Runtime configuration loaded from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    org_id: str
    keycloak_issuer: str
    keycloak_audience: str
    device_token_secret: str
    cors_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=os.getenv(
                "DATABASE_URL",
                "postgresql+asyncpg://llmguard:llmguard@postgres:5432/llmguard",
            ),
            org_id=os.getenv("ORG_ID", "default"),
            keycloak_issuer=os.getenv("KEYCLOAK_ISSUER", ""),
            keycloak_audience=os.getenv("KEYCLOAK_AUDIENCE", "llm-guard-dashboard"),
            device_token_secret=os.getenv("DEVICE_TOKEN_SECRET", "change-me-in-prod"),
            cors_origins=tuple(
                o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:4200").split(",") if o.strip()
            ),
        )


settings = Settings.from_env()
