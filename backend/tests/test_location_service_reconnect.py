"""Tests for DvtLocationService._reconnect retry semantics.

The reconnect ladder lives at services/location_service.py:262-288 and
totals ~15s of attempts when every error is generic. After the May 15
incident (a stale tunnel produced 5 back-to-back TimeoutErrors before
the outer hard-reset finally rebuilt the tunnel) we added an early-exit:
two consecutive ``TimeoutError``s now bail out immediately so the outer
``exec_with_retry`` can hard-reset the transport ~13s sooner.

These tests pin the new semantics:

  * Two consecutive ``TimeoutError``s → ``DeviceLostError`` raised
    before attempt 3 runs.
  * A ``ConnectionTerminatedError`` between two ``TimeoutError``s
    resets the streak — the channel-drop case still gets all 5 attempts.
  * A single ``TimeoutError`` followed by success completes normally.

Uses ``asyncio.run`` so we don't depend on pytest-asyncio. Mocks
``DvtProvider`` at the call site so we control which exception each
attempt raises without standing up a real iPhone.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


@pytest.fixture(autouse=True)
def _reset_state() -> Iterator[None]:
    """Wipe connection_state between tests so the mark_degraded /
    mark_recovered emits from one test don't leak into the next."""
    from services import connection_state
    connection_state.reset_for_tests()
    yield
    connection_state.reset_for_tests()


def _make_dvt_factory(exception_script: list[BaseException | None]):
    """Return a fake ``DvtProvider`` class that, when called, returns
    objects whose ``__aenter__`` consumes one entry from
    *exception_script* per call.

    Entries: ``None`` → success; ``BaseException`` → raise that exception.
    Once exhausted the factory raises ``IndexError`` so a test that
    runs more attempts than expected fails loudly.
    """
    call_idx = {"n": 0}

    def _factory(lockdown):  # mimics DvtProvider(lockdown) call
        idx = call_idx["n"]
        call_idx["n"] += 1
        item = exception_script[idx]  # IndexError if over-budget

        class _FakeProvider:
            async def __aenter__(self_inner):
                if item is not None:
                    raise item
                return self_inner

            async def __aexit__(self_inner, *_):
                return False

        return _FakeProvider()

    _factory.call_count = call_idx  # exposed for assertions
    return _factory


def _make_service(monkeypatch, *, exception_script: list[BaseException | None]):
    """Build a DvtLocationService wired to the scripted factory.

    Patches the module-level ``DvtProvider`` and shrinks
    ``DVT_RECONNECT_DELAYS`` to zero so tests don't actually sleep.
    Returns ``(service, factory)`` so callers can assert call_count.
    """
    from services import location_service

    factory = _make_dvt_factory(exception_script)
    monkeypatch.setattr(location_service, "DvtProvider", factory, raising=True)
    monkeypatch.setattr(
        location_service, "DVT_RECONNECT_DELAYS", [0.0, 0.0, 0.0, 0.0, 0.0],
        raising=True,
    )

    # Seed _dvt with a no-op aexit-able stub so _reconnect's "close old
    # DvtProvider" step succeeds. _ensure_instrument isn't exercised
    # by _reconnect itself, so location_sim can stay None.
    initial_dvt = MagicMock()
    initial_dvt.__aexit__ = AsyncMock(return_value=False)

    svc = location_service.DvtLocationService(
        dvt_provider=initial_dvt,
        lockdown=MagicMock(),
        udid="udid-test",
    )
    return svc, factory


def test_two_consecutive_timeouts_bail_to_device_lost(monkeypatch):
    """2 consecutive TimeoutErrors → DeviceLostError before attempt 3.

    Scripts 5 TimeoutErrors but only the first two should run; the
    factory raises IndexError if the loop tries a 3rd, which would
    surface as an unexpected exception type.
    """
    from services.location_service import DeviceLostError

    svc, factory = _make_service(
        monkeypatch,
        exception_script=[TimeoutError("t1"), TimeoutError("t2"),
                          TimeoutError("never"), TimeoutError("never"),
                          TimeoutError("never")],
    )

    with pytest.raises(DeviceLostError):
        asyncio.run(svc._reconnect())

    # Only 2 attempts should have been made — the streak triggered bail.
    assert factory.call_count["n"] == 2, (
        f"expected 2 attempts before early-exit, got {factory.call_count['n']}"
    )


def test_channel_drop_between_timeouts_resets_streak(monkeypatch):
    """TimeoutError → ConnectionTerminatedError → TimeoutError → … → success.

    The ConnectionTerminatedError in attempt 2 resets the consecutive-
    timeout streak so the loop continues. We script success on attempt 4
    to confirm the loop didn't bail early.
    """
    from pymobiledevice3.exceptions import ConnectionTerminatedError

    svc, factory = _make_service(
        monkeypatch,
        exception_script=[
            TimeoutError("t1"),
            ConnectionTerminatedError("channel drop"),
            TimeoutError("t3"),  # streak reset → does NOT bail
            None,                # attempt 4 succeeds
        ],
    )

    # Should NOT raise — recovery completes on attempt 4.
    asyncio.run(svc._reconnect())
    assert factory.call_count["n"] == 4


def test_single_timeout_then_success_completes_normally(monkeypatch):
    """One TimeoutError followed by success → no DeviceLostError.

    Streak counter is 1; the success on attempt 2 short-circuits before
    we reach the 2-in-a-row threshold.
    """
    svc, factory = _make_service(
        monkeypatch,
        exception_script=[TimeoutError("blip"), None],
    )

    asyncio.run(svc._reconnect())  # no raise
    assert factory.call_count["n"] == 2


def test_non_timeout_then_timeout_keeps_going(monkeypatch):
    """Non-TimeoutError on attempt 1 should NOT count toward the
    streak. attempt 2 TimeoutError is just streak=1, not enough to bail.

    Scripts: generic OSError → TimeoutError → success on attempt 3.
    """
    svc, factory = _make_service(
        monkeypatch,
        exception_script=[OSError("transient"), TimeoutError("t2"), None],
    )

    asyncio.run(svc._reconnect())  # no raise
    assert factory.call_count["n"] == 3
