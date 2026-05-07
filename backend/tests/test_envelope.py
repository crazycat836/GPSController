"""Tests for the response-envelope wrapper.

The review (2026-05-06, LOW item) flagged that the bypass mechanism in
``EnvelopeJSONResponse.render`` is implicit: any payload that happens
to be a dict containing the three keys (``success``, ``data``,
``error``) skips the auto-wrap. A future endpoint that legitimately
returns a dict whose top level coincidentally has those keys would
silently bypass the envelope and ship a malformed response.

These tests pin the current behaviour so the bypass remains
intentional — if the predicate ever changes, the diff stays visible.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make `backend/` importable when pytest runs from the repo root.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from api._envelope import EnvelopeJSONResponse, _is_already_enveloped  # noqa: E402


def _render_dict(content) -> dict:
    """Helper — render the payload through EnvelopeJSONResponse and parse
    the resulting JSON bytes back into a dict so tests can assert shape
    without juggling bytes."""
    body = EnvelopeJSONResponse(content=content).body
    return json.loads(body)


def test_plain_dict_gets_wrapped():
    out = _render_dict({"hello": "world"})
    assert out == {"success": True, "data": {"hello": "world"}, "error": None}


def test_list_gets_wrapped_under_data():
    out = _render_dict([1, 2, 3])
    assert out == {"success": True, "data": [1, 2, 3], "error": None}


def test_existing_envelope_passes_through_untouched():
    payload = {"success": True, "data": {"x": 1}, "error": None, "meta": {"page": 1}}
    out = _render_dict(payload)
    assert out == payload  # exact same shape, no double-wrap


def test_envelope_predicate_requires_all_three_keys():
    # Missing one of {success, data, error} → not enveloped → wrap.
    assert _is_already_enveloped({"success": True}) is False
    assert _is_already_enveloped({"data": None}) is False
    assert _is_already_enveloped({"success": True, "data": None}) is False
    # All three present (regardless of values) → enveloped.
    assert _is_already_enveloped({"success": True, "data": None, "error": None}) is True


def test_dict_coincidentally_containing_success_key_is_treated_as_envelope():
    """Documents the implicit bypass the review flagged.

    If a future endpoint returns a payload like
    ``{"success": "ok", "data": ..., "error": ...}`` (where these are
    *application* fields, not envelope fields), it WILL bypass the
    auto-wrap. This test pins that behaviour so the surprise can't be
    silent — if the predicate ever changes, this assertion will need
    intentional updating.
    """
    misleading = {"success": "ok", "data": {"items": []}, "error": "no"}
    out = _render_dict(misleading)
    assert out == misleading
