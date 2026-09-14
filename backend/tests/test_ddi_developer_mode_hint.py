"""``ensure_personalized_ddi_mounted`` must keep the event loop alive while
the image downloads, and tell the UI *why* a mount failed.

- The personalized image comes from GitHub via a synchronous ``requests``
  call. Run on the loop it froze the backend long enough for the WiFi
  tunnel to drop; it now runs on a thread and is shared across callers.
- A major iOS upgrade resets Developer Mode, the phone may be locked, the
  link may drop mid-mount, or GitHub may be slow. Each gets its own
  ``reason`` / ``hint_key`` so the banner doesn't blame the wrong thing.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import core.ddi_mount as ddi_mount  # noqa: E402
import pymobiledevice3.services.mobile_image_mounter as mim  # noqa: E402
import services.ws_broadcaster as ws_broadcaster  # noqa: E402
from pymobiledevice3.exceptions import (  # noqa: E402
    DeveloperModeIsNotEnabledError,
    PyMobileDevice3Exception,
)

_PATHS = (Path("Image.dmg"), Path("BuildManifest.plist"), Path("Image.trustcache"))


class _NotMountedMounter:
    def __init__(self, lockdown=None):
        pass

    async def connect(self):
        return None

    async def is_image_mounted(self, image_type):
        return False

    async def close(self):
        return None


def _mounter_raising(exc: BaseException | None, calls: list | None = None):
    class _Mounter:
        def __init__(self, lockdown=None):
            pass

        async def mount(self, image, build_manifest, trustcache):
            if calls is not None:
                calls.append((image, build_manifest, trustcache))
            if exc is not None:
                raise exc

    return _Mounter


@pytest.fixture
def env(monkeypatch):
    """Not-mounted device, cached image, recorded broadcasts."""
    monkeypatch.setattr(mim, "MobileImageMounterService", _NotMountedMounter)
    monkeypatch.setattr(ddi_mount, "_fetch_personalized_ddi", lambda: _PATHS)
    monkeypatch.setattr(ddi_mount, "_personalized_ddi_cached", lambda: True)
    monkeypatch.setattr(ddi_mount, "_download_future", None)
    broadcast = AsyncMock()
    monkeypatch.setattr(ws_broadcaster, "broadcast", broadcast)
    return SimpleNamespace(monkeypatch=monkeypatch, broadcast=broadcast)


def _conn(udid="UDID-1"):
    return SimpleNamespace(udid=udid, lockdown=object(), developer_mode_enabled=None)


def _events(broadcast):
    return [(call.args[0], call.args[1]) for call in broadcast.await_args_list]


def _missing(broadcast):
    return dict(_events(broadcast))["ddi_mount_missing"]


def test_developer_mode_off_broadcasts_dedicated_hint(env):
    env.monkeypatch.setattr(mim, "PersonalizedImageMounter", _mounter_raising(DeveloperModeIsNotEnabledError()))
    conn = _conn()

    with pytest.raises(DeveloperModeIsNotEnabledError):
        asyncio.run(ddi_mount.ensure_personalized_ddi_mounted(conn, asyncio.Lock()))

    events = dict(_events(env.broadcast))
    assert "ddi_mounting" in events
    assert "ddi_mounted" not in events
    missing = events["ddi_mount_missing"]
    assert missing["reason"] == ddi_mount.REASON_DEVELOPER_MODE_DISABLED
    assert missing["hint_key"] == ddi_mount.HINT_KEY_DEVELOPER_MODE
    assert missing["udid"] == "UDID-1"
    failed = events["ddi_mount_failed"]
    assert failed["reason"] == ddi_mount.REASON_DEVELOPER_MODE_DISABLED
    assert failed["hint_key"] == ddi_mount.HINT_KEY_DEVELOPER_MODE
    # /device/list reads this cache so the manage view can offer "reveal".
    assert conn.developer_mode_enabled is False


def test_other_mount_errors_keep_generic_hint(env):
    env.monkeypatch.setattr(mim, "PersonalizedImageMounter", _mounter_raising(ValueError("boom")))
    conn = _conn("UDID-2")

    with pytest.raises(ValueError):
        asyncio.run(ddi_mount.ensure_personalized_ddi_mounted(conn, asyncio.Lock()))

    missing = _missing(env.broadcast)
    assert missing["hint_key"] == ddi_mount.HINT_KEY_DEFAULT
    assert missing["reason"] == "ValueError: boom"
    assert conn.developer_mode_enabled is None


def test_locked_phone_gets_unlock_hint(env):
    exc = PyMobileDevice3Exception("command ReceiveBytes failed with: {'Error': 'DeviceLocked'}")
    env.monkeypatch.setattr(mim, "PersonalizedImageMounter", _mounter_raising(exc))

    with pytest.raises(PyMobileDevice3Exception):
        asyncio.run(ddi_mount.ensure_personalized_ddi_mounted(_conn(), asyncio.Lock()))

    assert _missing(env.broadcast)["hint_key"] == ddi_mount.HINT_KEY_DEVICE_LOCKED


@pytest.mark.parametrize("exc", [
    TimeoutError(60, "Operation timed out"),
    OSError(65, "No route to host"),
    RuntimeError("unable to perform operation on <TCPTransport closed=True>; the handler is closed"),
])
def test_dropped_link_gets_unreachable_hint_not_github(env, exc):
    env.monkeypatch.setattr(mim, "PersonalizedImageMounter", _mounter_raising(exc))

    with pytest.raises(type(exc)):
        asyncio.run(ddi_mount.ensure_personalized_ddi_mounted(_conn(), asyncio.Lock()))

    missing = _missing(env.broadcast)
    assert missing["reason"] == ddi_mount.REASON_DEVICE_UNREACHABLE
    assert missing["hint_key"] == ddi_mount.HINT_KEY_DEVICE_UNREACHABLE


def test_download_keeps_loop_responsive_and_reports_stages(env):
    calls: list = []
    env.monkeypatch.setattr(ddi_mount, "_personalized_ddi_cached", lambda: False)

    def slow_fetch():
        time.sleep(0.5)  # the blocking requests.get stand-in
        return _PATHS

    env.monkeypatch.setattr(ddi_mount, "_fetch_personalized_ddi", slow_fetch)
    env.monkeypatch.setattr(mim, "PersonalizedImageMounter", _mounter_raising(None, calls))

    async def scenario():
        ticks = 0
        done = asyncio.Event()

        async def heartbeat():
            nonlocal ticks
            while not done.is_set():
                ticks += 1
                await asyncio.sleep(0.05)

        hb = asyncio.create_task(heartbeat())
        await ddi_mount.ensure_personalized_ddi_mounted(_conn(), asyncio.Lock())
        done.set()
        await hb
        return ticks

    ticks = asyncio.run(scenario())

    assert ticks > 5, "event loop was blocked during the download"
    assert calls == [_PATHS]
    stages = [data.get("stage") for name, data in _events(env.broadcast) if name == "ddi_mounting"]
    assert stages == ["downloading", "mounting"]
    assert "ddi_mounted" in dict(_events(env.broadcast))


def test_concurrent_mounts_share_one_download(env):
    fetches = []

    def fetch():
        fetches.append(1)
        time.sleep(0.2)
        return _PATHS

    env.monkeypatch.setattr(ddi_mount, "_fetch_personalized_ddi", fetch)
    env.monkeypatch.setattr(mim, "PersonalizedImageMounter", _mounter_raising(None))

    async def scenario():
        lock = asyncio.Lock()
        await asyncio.gather(
            ddi_mount.ensure_personalized_ddi_mounted(_conn("A"), lock),
            ddi_mount.ensure_personalized_ddi_mounted(_conn("B"), lock),
            ddi_mount.prefetch_personalized_ddi(),
        )

    env.monkeypatch.setattr(ddi_mount, "_personalized_ddi_cached", lambda: False)
    asyncio.run(scenario())
    assert len(fetches) == 1


def test_download_timeout_says_network_and_download_continues(env):
    env.monkeypatch.setattr(ddi_mount, "_personalized_ddi_cached", lambda: False)
    env.monkeypatch.setattr(ddi_mount, "DDI_DOWNLOAD_TIMEOUT_S", 0.1)
    finished = []

    def slow_fetch():
        time.sleep(0.4)
        finished.append(1)
        return _PATHS

    env.monkeypatch.setattr(ddi_mount, "_fetch_personalized_ddi", slow_fetch)
    env.monkeypatch.setattr(mim, "PersonalizedImageMounter", _mounter_raising(None))

    async def scenario():
        with pytest.raises(RuntimeError, match="download timed out"):
            await ddi_mount.ensure_personalized_ddi_mounted(_conn(), asyncio.Lock())
        # The shared download was not cancelled by the waiter giving up.
        await asyncio.wait_for(asyncio.shield(ddi_mount._download_future), 2)

    asyncio.run(scenario())
    missing = _missing(env.broadcast)
    assert missing["hint_key"] == ddi_mount.HINT_KEY_DOWNLOAD_TIMEOUT
    assert missing["stage"] == "download"
    assert finished == [1]


def test_download_error_gets_download_failed_hint(env):
    env.monkeypatch.setattr(ddi_mount, "_personalized_ddi_cached", lambda: False)

    def broken_fetch():
        raise ConnectionError("github unreachable")

    env.monkeypatch.setattr(ddi_mount, "_fetch_personalized_ddi", broken_fetch)

    with pytest.raises(ConnectionError):
        asyncio.run(ddi_mount.ensure_personalized_ddi_mounted(_conn(), asyncio.Lock()))

    assert _missing(env.broadcast)["hint_key"] == ddi_mount.HINT_KEY_DOWNLOAD_FAILED


def test_bounded_requests_adds_timeout():
    seen = {}

    class _Real:
        codes = "passthrough"

        def get(self, url, **kwargs):
            seen.update(kwargs)
            return url

    wrapped = ddi_mount._BoundedRequests(_Real())
    assert wrapped.get("u") == "u"
    assert seen["timeout"] == ddi_mount.DDI_HTTP_TIMEOUT
    assert wrapped.codes == "passthrough"
