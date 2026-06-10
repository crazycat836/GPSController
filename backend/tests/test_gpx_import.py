"""Regression tests for ``POST /api/route/gpx/import`` error handling.

Bug 2.3: ``import_gpx`` decoded the upload bytes defensively (content
type, size, encoding all map to structured 400s) but passed the decoded
text to ``gpx_service.parse_gpx`` unguarded. Malformed-but-decodable XML
made ``gpxpy.parse`` raise ``GPXXMLSyntaxException``, which escaped the
handler and produced Starlette's plain-text 500 instead of the project's
``{success, data, error}`` envelope.

These tests call the handler directly (same style as the rest of the
suite — no TestClient, async driven via ``asyncio.run``).
"""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

# Make `backend/` importable when pytest runs from the repo root.
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from api.route import import_gpx  # noqa: E402


@pytest.fixture(autouse=True)
def _stub_app_state(monkeypatch):
    """Park a minimal AppState stand-in on ctx so the api._deps accessors
    resolve (the route singletons live on AppState now, not as module
    globals in api.route). The store's ``add`` is stubbed so these tests
    never persist to the real routes file."""
    from types import SimpleNamespace

    from context import ctx
    from services.gpx_service import GpxService

    async def _fake_add(route, on_conflict="new"):
        return route, "new"

    stub = SimpleNamespace(
        gpx_service=GpxService(),
        saved_routes_store=SimpleNamespace(add=_fake_add),
    )
    monkeypatch.setattr(ctx, "app_state", stub, raising=False)


def _make_upload(content: bytes, filename: str = "trace.gpx") -> UploadFile:
    """Build a real Starlette UploadFile around in-memory bytes."""
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": "application/gpx+xml"}),
    )


def test_malformed_xml_returns_structured_400_not_unhandled_exception():
    """Truncated XML (decodable as UTF-8, invalid as XML) must surface
    as the same structured 400 the other decode failures use — not an
    unhandled gpxpy exception that becomes a plain-text 500."""
    upload = _make_upload(b"<gpx version='1.1'><trk><trkseg><trkpt lat='25.0'")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(import_gpx(file=upload))

    assert exc_info.value.status_code == 400
    detail = exc_info.value.detail
    assert detail["code"] == "gpx_decode_failed"
    assert isinstance(detail["message"], str) and detail["message"]


def test_non_xml_text_returns_structured_400():
    """Plain text that decodes fine but isn't XML at all also maps to
    the structured 400 instead of leaking a gpxpy exception."""
    upload = _make_upload(b"this is not xml at all, just text")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(import_gpx(file=upload))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "gpx_decode_failed"


def test_valid_gpx_still_imports():
    """Negative control: the new guard must not swallow the happy path.

    The store's ``add`` is stubbed (see ``_stub_app_state``) so the test
    never persists to the real routes file.
    """
    gpx_xml = (
        b"<?xml version='1.0' encoding='UTF-8'?>"
        b"<gpx version='1.1' creator='test'>"
        b"<trk><trkseg>"
        b"<trkpt lat='25.0330' lon='121.5654'></trkpt>"
        b"<trkpt lat='25.0340' lon='121.5660'></trkpt>"
        b"</trkseg></trk></gpx>"
    )
    upload = _make_upload(gpx_xml)

    result = asyncio.run(import_gpx(file=upload))

    assert result["status"] == "imported"
    assert result["points"] == 2
