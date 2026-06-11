"""Tests for core.wifi_tunnel.connect_with_retries.

pymobiledevice3 hard-codes a 1-second TCP timeout for the RemotePairing
connect (``tunnel_service.TIMEOUT``). A WiFi iPhone with a locked screen
routinely drops the first SYN while waking its radio, so a single attempt
times out and surfaces as ``tunnel_timeout`` even though the 20 s start
budget has barely been touched. The retry helper absorbs those transient
misses but must NOT retry a pair-verify rejection (definitive) and must
bail early when the runner is being stopped.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def _counting_connect(failures: list[BaseException], result: str = "service"):
    calls = {"n": 0}

    async def _connect():
        calls["n"] += 1
        if calls["n"] <= len(failures):
            raise failures[calls["n"] - 1]
        return result

    return _connect, calls


def test_retries_transient_timeout_then_succeeds():
    from core.wifi_tunnel import connect_with_retries

    connect, calls = _counting_connect([asyncio.TimeoutError()])
    result = asyncio.run(
        connect_with_retries(connect, attempts=3, delay_s=0.01)
    )
    assert result == "service"
    assert calls["n"] == 2


def test_raises_after_exhausting_attempts():
    from core.wifi_tunnel import connect_with_retries

    connect, calls = _counting_connect(
        [asyncio.TimeoutError(), asyncio.TimeoutError(), asyncio.TimeoutError()]
    )
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(connect_with_retries(connect, attempts=3, delay_s=0.01))
    assert calls["n"] == 3


def test_pair_rejection_is_not_retried():
    from pymobiledevice3.exceptions import ConnectionTerminatedError
    from core.wifi_tunnel import connect_with_retries

    connect, calls = _counting_connect([ConnectionTerminatedError()])
    with pytest.raises(ConnectionTerminatedError):
        asyncio.run(connect_with_retries(connect, attempts=3, delay_s=0.01))
    assert calls["n"] == 1


def test_stop_event_aborts_between_attempts():
    from core.wifi_tunnel import connect_with_retries

    stop = asyncio.Event()

    calls = {"n": 0}

    async def _connect():
        calls["n"] += 1
        stop.set()
        raise asyncio.TimeoutError()

    async def _run():
        return await connect_with_retries(
            _connect, attempts=5, delay_s=0.01, stop_event=stop,
        )

    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(_run())
    assert calls["n"] == 1
