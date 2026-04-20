"""FastAPI application entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import settings
from .ingest import router as ingest_router
from .live import router as live_router
from .query import router as query_router

app = FastAPI(title="LLM Guard API", version=__version__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/v1/health")
async def health() -> dict:
    return {"status": "ok", "version": __version__}


app.include_router(ingest_router)
app.include_router(query_router)
app.include_router(live_router)
