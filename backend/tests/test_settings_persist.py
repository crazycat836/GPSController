"""Tests for settings-persistence failure surfacing.

``AppState.save_settings`` used to swallow every write failure with a
warning, so the PUT settings endpoints answered 200 while the write
evaporated. It now returns False on failure and the settings routes map
that to a 500 ``settings_persist_failed`` envelope.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

# Make `backend/` importable when pytest runs from the repo root.
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import state as state_mod  # noqa: E402
from api.location.settings import (  # noqa: E402
    _InitialPosRequest,
    set_coord_format,
    set_initial_position,
    set_wifi_keepalive,
)
from context import ctx  # noqa: E402
from models.schemas import CoordFormatRequest, CoordinateFormat  # noqa: E402
from services.coord_format import CoordinateFormatter  # noqa: E402
from state import AppState  # noqa: E402


# ── AppState.save_settings ───────────────────────────────


def _bare_state() -> AppState:
    """AppState without the heavy __init__ (DeviceManager, stores, …) —
    only the attributes save_settings reads."""
    st = AppState.__new__(AppState)
    st._last_position = None
    st._initial_map_position = None
    st._wifi_keepalive = False
    st.coord_formatter = CoordinateFormatter()
    return st


class _ExplodingPath:
    def write_text(self, *args, **kwargs):
        raise OSError("disk full")

    def __str__(self) -> str:  # logger interpolates the target path
        return "<exploding settings.json>"


def test_save_settings_returns_false_when_write_fails(monkeypatch):
    monkeypatch.setattr(state_mod, "SETTINGS_FILE", _ExplodingPath())

    assert _bare_state().save_settings() is False


def test_save_settings_returns_true_and_persists_on_success(tmp_path, monkeypatch):
    target = tmp_path / "settings.json"
    monkeypatch.setattr(state_mod, "SETTINGS_FILE", target)

    st = _bare_state()

    assert st.save_settings() is True
    assert json.loads(target.read_text(encoding="utf-8"))["wifi_keepalive"] is False


def test_set_wifi_keepalive_propagates_persist_failure(monkeypatch):
    monkeypatch.setattr(state_mod, "SETTINGS_FILE", _ExplodingPath())
    st = _bare_state()

    assert st.set_wifi_keepalive(True) is False
    # In-memory toggle still applied; only persistence failed.
    assert st.get_wifi_keepalive() is True


# ── Route mapping: False → 500 settings_persist_failed ──


def _stub_app_state(monkeypatch, *, persist_ok: bool) -> SimpleNamespace:
    stub = SimpleNamespace(
        coord_formatter=CoordinateFormatter(),
        save_settings=lambda: persist_ok,
        set_initial_position=lambda pos: None,
        set_wifi_keepalive=lambda enabled: persist_ok,
        get_wifi_keepalive=lambda: True,
    )
    monkeypatch.setattr(ctx, "app_state", stub, raising=False)
    return stub


def _assert_persist_500(exc_info) -> None:
    assert exc_info.value.status_code == 500
    assert exc_info.value.detail["code"] == "settings_persist_failed"


def test_put_coord_format_returns_500_when_persist_fails(monkeypatch):
    _stub_app_state(monkeypatch, persist_ok=False)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(set_coord_format(CoordFormatRequest(format=CoordinateFormat.DMS)))

    _assert_persist_500(exc_info)


def test_put_initial_position_returns_500_when_persist_fails(monkeypatch):
    _stub_app_state(monkeypatch, persist_ok=False)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(set_initial_position(_InitialPosRequest(lat=25.04, lng=121.56)))

    _assert_persist_500(exc_info)


def test_put_wifi_keepalive_returns_500_when_persist_fails(monkeypatch):
    _stub_app_state(monkeypatch, persist_ok=False)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(set_wifi_keepalive(SimpleNamespace(enabled=True)))

    _assert_persist_500(exc_info)


def test_put_routes_succeed_when_persist_succeeds(monkeypatch):
    _stub_app_state(monkeypatch, persist_ok=True)

    assert asyncio.run(set_coord_format(CoordFormatRequest(format=CoordinateFormat.DD))) == {
        "format": "dd",
    }
    assert asyncio.run(set_initial_position(_InitialPosRequest(lat=1.0, lng=2.0))) == {
        "position": {"lat": 1.0, "lng": 2.0},
    }
    assert asyncio.run(set_wifi_keepalive(SimpleNamespace(enabled=True))) == {"enabled": True}


def test_settings_persist_failed_is_a_registered_error_code():
    """Must live in the ErrorCode registry so gen_ws_types.py mirrors it
    into BACKEND_ERROR_CODES and the frontend i18n contract test covers
    ``err.settings_persist_failed``."""
    from api._errors import ErrorCode

    assert ErrorCode.SETTINGS_PERSIST_FAILED.value == "settings_persist_failed"
