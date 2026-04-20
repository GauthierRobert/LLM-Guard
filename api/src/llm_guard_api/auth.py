"""Authentication helpers.

Two principal flows:
  1. Device token (HMAC, bearer) — used by the Chrome extension to POST events.
  2. User OIDC (Keycloak) — used by the dashboard frontend. Stubbed for now.
"""
from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

from fastapi import Header, HTTPException, status

from .config import settings


@dataclass(frozen=True)
class DevicePrincipal:
    device_id: str
    org_id: str


def hash_token(token: str) -> str:
    """HMAC-SHA256 of the token using the server-side secret. Stored in DB for lookups."""
    return hmac.new(settings.device_token_secret.encode(), token.encode(), hashlib.sha256).hexdigest()


async def require_device(authorization: str | None = Header(default=None)) -> DevicePrincipal:
    """Validate a device bearer token. In a real deployment, look up token_hash in `devices`
    table and mark `last_seen_at`. This stub accepts any non-empty bearer token in the
    single-tenant dev build and derives device_id from the hash prefix."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Empty token")
    token_hash = hash_token(token)
    # TODO: SELECT device_id FROM devices WHERE token_hash = :h AND revoked = false
    # For now derive a stable pseudo device_id from the hash for scaffolding.
    return DevicePrincipal(device_id=token_hash[:32], org_id=settings.org_id)


async def require_user(authorization: str | None = Header(default=None)) -> dict:
    """Validate a user OIDC JWT from Keycloak. Stubbed: accepts any non-empty token."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    # TODO: verify signature against Keycloak JWKS, check aud + iss, extract claims.
    return {"sub": "dev-user", "org_id": settings.org_id, "roles": ["admin"]}
