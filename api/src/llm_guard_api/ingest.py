"""POST /v1/events — device-authenticated batch ingest."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import DevicePrincipal, require_device
from .db import get_session
from .models import Event as EventRow
from .schema import EventBatch, IngestResult

router = APIRouter(prefix="/v1", tags=["ingest"])


@router.post("/events", response_model=IngestResult)
async def ingest_events(
    batch: EventBatch,
    principal: DevicePrincipal = Depends(require_device),
    session: AsyncSession = Depends(get_session),
) -> IngestResult:
    """Insert a batch of events idempotently (eventId is the idempotency key)."""
    existing = await session.execute(
        select(EventRow.event_id).where(EventRow.event_id.in_([e.eventId for e in batch.events]))
    )
    seen = {row[0] for row in existing.all()}

    rows: list[EventRow] = []
    for ev in batch.events:
        if ev.eventId in seen:
            continue
        rows.append(
            EventRow(
                event_id=ev.eventId,
                timestamp=ev.timestamp,
                org_id=ev.orgId,
                device_id=ev.deviceId,
                user_hint=ev.userHint,
                hostname=ev.hostname,
                llm=ev.llm,
                action=ev.action,
                endpoint=ev.endpoint,
                mode=ev.mode,
                prompt_length=ev.promptLength,
                mappings_count=ev.mappingsCount,
                anonymized_preview=ev.anonymizedPreview,
                findings=[f.model_dump() for f in ev.findings],
                extension_version=ev.extensionVersion,
            )
        )

    session.add_all(rows)
    await session.commit()
    return IngestResult(accepted=len(rows), duplicates=len(seen))
