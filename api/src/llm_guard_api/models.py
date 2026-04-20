"""SQLAlchemy ORM models. Events are stored in a TimescaleDB hypertable."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Org(Base):
    __tablename__ = "orgs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[str] = mapped_column(ForeignKey("orgs.id"), nullable=False, index=True)
    user_hint: Mapped[str | None] = mapped_column(String(254))
    extension_version: Mapped[str | None] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime | None] = mapped_column()
    revoked: Mapped[bool] = mapped_column(default=False)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_org_ts", "org_id", "timestamp"),
        Index("ix_events_device_ts", "device_id", "timestamp"),
        Index("ix_events_llm", "llm"),
        Index("ix_events_action", "action"),
    )

    # Composite PK: TimescaleDB hypertables require the partition column
    # (timestamp) to be part of the primary key.
    event_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(primary_key=True, index=True)
    org_id: Mapped[str] = mapped_column(String(64), nullable=False)
    device_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    user_hint: Mapped[str | None] = mapped_column(String(254))
    hostname: Mapped[str] = mapped_column(String(253), nullable=False)
    llm: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    endpoint: Mapped[str | None] = mapped_column(String(512))
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    prompt_length: Mapped[int] = mapped_column(nullable=False, default=0)
    mappings_count: Mapped[int] = mapped_column(nullable=False, default=0)
    anonymized_preview: Mapped[str | None] = mapped_column(Text)
    findings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    extension_version: Mapped[str] = mapped_column(String(32), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(server_default=func.now())
