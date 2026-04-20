"""GET /v1/stats, /v1/events, /v1/findings/by-type — dashboard query endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_user
from .db import get_session
from .models import Event as EventRow
from .schema import StatsResponse

router = APIRouter(prefix="/v1", tags=["query"])

RANGE_MAP = {
    "1h": timedelta(hours=1),
    "24h": timedelta(days=1),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def _since(range_key: str) -> datetime:
    delta = RANGE_MAP.get(range_key, RANGE_MAP["24h"])
    return datetime.now(tz=timezone.utc) - delta


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    range: str = Query("24h"),
    user: dict = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> StatsResponse:
    since = _since(range)
    org_id = user["org_id"]

    action_rows = await session.execute(
        select(EventRow.action, func.count())
        .where(EventRow.org_id == org_id, EventRow.timestamp >= since)
        .group_by(EventRow.action)
    )
    by_action = {a: c for a, c in action_rows.all()}

    llm_rows = await session.execute(
        select(EventRow.llm, func.count())
        .where(EventRow.org_id == org_id, EventRow.timestamp >= since)
        .group_by(EventRow.llm)
    )
    by_llm = {llm: c for llm, c in llm_rows.all()}

    # Unnest JSONB findings to count by type.
    findings_q = f"""
        SELECT (f->>'type') AS t, SUM((f->>'count')::int) AS c
        FROM events, jsonb_array_elements(findings) AS f
        WHERE org_id = :org AND timestamp >= :since
        GROUP BY t
        ORDER BY c DESC
        LIMIT 50
    """
    raw = await session.execute(
        findings_q, {"org": org_id, "since": since}  # type: ignore[arg-type]
    )
    by_type = {t: int(c) for t, c in raw.all()}

    return StatsResponse(
        total=sum(by_action.values()),
        clean=by_action.get("CLEAN", 0),
        flagged=by_action.get("PII_DETECTED", 0),
        blocked=by_action.get("BLOCKED", 0),
        anonymized=by_action.get("ANONYMIZED", 0),
        by_llm=by_llm,
        by_type=by_type,
    )


@router.get("/events")
async def list_events(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    severity: str | None = None,
    llm: str | None = None,
    action: str | None = None,
    range: str = Query("24h"),
    user: dict = Depends(require_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(EventRow).where(
        EventRow.org_id == user["org_id"],
        EventRow.timestamp >= _since(range),
    )
    if llm:
        q = q.where(EventRow.llm == llm)
    if action:
        q = q.where(EventRow.action == action)
    q = q.order_by(EventRow.timestamp.desc()).limit(limit).offset(offset)

    rows = (await session.execute(q)).scalars().all()
    items = [
        {
            "eventId": str(r.event_id),
            "timestamp": r.timestamp.isoformat(),
            "deviceId": str(r.device_id),
            "userHint": r.user_hint,
            "hostname": r.hostname,
            "llm": r.llm,
            "action": r.action,
            "endpoint": r.endpoint,
            "mode": r.mode,
            "promptLength": r.prompt_length,
            "mappingsCount": r.mappings_count,
            "anonymizedPreview": r.anonymized_preview,
            "findings": r.findings,
            "extensionVersion": r.extension_version,
        }
        for r in rows
        if not severity
        or any(f.get("severity") == severity for f in (r.findings or []))
    ]
    return {"items": items, "limit": limit, "offset": offset}
