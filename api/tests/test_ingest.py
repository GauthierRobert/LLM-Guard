"""Smoke test for the ingest schema — does not touch a real DB."""
from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from llm_guard_api.schema import Event, EventBatch


def _valid_payload() -> dict:
    return {
        "eventId": str(uuid4()),
        "deviceId": str(uuid4()),
        "orgId": "acme",
        "userHint": None,
        "timestamp": "2026-04-20T12:00:00Z",
        "hostname": "chatgpt.com",
        "llm": "ChatGPT",
        "action": "ANONYMIZED",
        "endpoint": "/api/conversation",
        "mode": "anonymize",
        "promptLength": 120,
        "mappingsCount": 2,
        "anonymizedPreview": "[EMAIL_1] for [PHONE_2]",
        "findings": [{"type": "Email", "severity": "high", "count": 1}],
        "extensionVersion": "2.0.0",
        "schemaVersion": 1,
    }


def test_event_accepts_valid_payload():
    Event.model_validate(_valid_payload())


def test_event_rejects_bad_action():
    bad = _valid_payload()
    bad["action"] = "HACK"
    with pytest.raises(ValidationError):
        Event.model_validate(bad)


def test_event_rejects_extra_fields():
    bad = _valid_payload()
    bad["promptPreview"] = "leaked raw prompt"
    with pytest.raises(ValidationError):
        Event.model_validate(bad)


def test_batch_enforces_max_length():
    payload = _valid_payload()
    batch = {"events": [payload] * 501}
    with pytest.raises(ValidationError):
        EventBatch.model_validate(batch)
