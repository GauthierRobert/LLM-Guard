"""WebSocket /v1/live — realtime event stream for the dashboard.

Minimal fan-out implementation: in-process broker holds a set of subscribers
and forwards events from the ingest path. For multi-replica deployments,
swap for Redis Pub/Sub or Postgres LISTEN/NOTIFY.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/v1", tags=["live"])


class Broker:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, org_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs[org_id].add(q)
        return q

    def unsubscribe(self, org_id: str, q: asyncio.Queue) -> None:
        self._subs[org_id].discard(q)

    async def publish(self, org_id: str, event: dict) -> None:
        for q in list(self._subs.get(org_id, ())):
            if not q.full():
                await q.put(event)


broker = Broker()


@router.websocket("/live")
async def live_stream(ws: WebSocket) -> None:
    await ws.accept()
    # TODO: authenticate via `?token=` query param (Keycloak JWT) before subscribing.
    org_id = ws.query_params.get("org", "default")
    q = broker.subscribe(org_id)
    try:
        while True:
            event = await q.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        broker.unsubscribe(org_id, q)
