"""Local usage-log ingestion (`/api/usage/*`). See services/usage_log.py."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from config import DATA_DIR
from services.usage_log import UsageLog

router = APIRouter(prefix="/api/usage", tags=["usage"])

_usage_log = UsageLog(DATA_DIR / "usage")


class UsageEvent(BaseModel):
    """One renderer-side interaction. Only short descriptive strings are
    accepted — no free-form payloads, so bodies/coordinates can't slip in."""

    ts: int = Field(..., description="Epoch milliseconds (renderer clock)")
    session: str = Field(..., max_length=40)
    env: Literal["dev", "prod"] | None = None
    type: Literal["click", "key", "dialog_open", "dialog_close", "api"]
    region: str | None = Field(None, max_length=80)
    label: str | None = Field(None, max_length=80)
    method: str | None = Field(None, max_length=10)
    path: str | None = Field(None, max_length=200)
    status: int | None = None
    ok: bool | None = None
    code: str | None = Field(None, max_length=80)
    ms: int | None = None


class UsageBatch(BaseModel):
    events: list[UsageEvent] = Field(..., max_length=500)


@router.post("/events")
async def record_events(batch: UsageBatch):
    written = _usage_log.append(e.model_dump(exclude_none=True) for e in batch.events)
    return {"written": written}
