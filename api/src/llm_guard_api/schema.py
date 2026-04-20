"""Pydantic models mirroring shared/schema.json — the wire contract with the extension."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["critical", "high", "medium", "low"]
Action = Literal["CLEAN", "ANONYMIZED", "PII_DETECTED", "BLOCKED"]
LLM = Literal["ChatGPT", "Claude", "Gemini", "Copilot", "Unknown"]
Mode = Literal["anonymize", "block"]


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str = Field(min_length=1, max_length=128)
    severity: Severity
    count: int = Field(ge=1)


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")

    eventId: UUID
    deviceId: UUID
    orgId: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    userHint: str | None = Field(default=None, max_length=254)
    timestamp: datetime
    hostname: str = Field(min_length=1, max_length=253)
    llm: LLM
    action: Action
    endpoint: str | None = Field(default=None, max_length=512)
    mode: Mode
    promptLength: int = Field(ge=0)
    mappingsCount: int = Field(ge=0)
    anonymizedPreview: str | None = Field(default=None, max_length=200)
    findings: list[Finding] = Field(default_factory=list, max_length=50)
    extensionVersion: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    schemaVersion: Literal[1]


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[Event] = Field(min_length=1, max_length=500)


class IngestResult(BaseModel):
    accepted: int
    duplicates: int


class StatsResponse(BaseModel):
    total: int
    clean: int
    flagged: int
    blocked: int
    anonymized: int
    by_llm: dict[str, int]
    by_type: dict[str, int]
