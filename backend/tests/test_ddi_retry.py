"""``POST /api/device/{udid}/ddi/retry`` re-runs the DDI mount on a live
connection.

After a failed mount the connection caches whatever location service was
built at the time (often the legacy fallback), so simply reconnecting
would reuse it and never mount again. Retry must stop the engine, drop the
cached service, and rebuild — which goes back through the mount.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from core.device_manager import DeviceManager  # noqa: E402


class _Service:
    def __init__(self) -> None:
        self.closed = False

    async def aclose(self) -> None:
        self.closed = True


class _Provider:
    def __init__(self) -> None:
        self.exited = False

    async def __aexit__(self, *exc) -> None:
        self.exited = True


@pytest.fixture(autouse=True)
def _restore_ctx() -> Iterator[None]:
    from context import ctx
    saved = getattr(ctx, "app_state", None)
    yield
    ctx.app_state = saved


def test_reset_location_service_closes_and_forgets_the_cached_stack():
    dm = DeviceManager()
    service, provider = _Service(), _Provider()
    conn = SimpleNamespace(location_service=service, dvt_provider=provider)
    dm._connections["UDID-1"] = conn

    asyncio.run(dm.reset_location_service("UDID-1"))

    assert service.closed and provider.exited
    assert conn.location_service is None
    assert conn.dvt_provider is None


def test_retry_rebuilds_engine_after_dropping_the_service():
    from api import device
    from context import ctx

    calls: list[str] = []

    class _DM:
        def is_connected(self, udid):
            return True

        async def reset_location_service(self, udid):
            calls.append(f"reset:{udid}")

    class _AppState:
        device_manager = _DM()

        async def terminate_engine(self, udid):
            calls.append(f"terminate:{udid}")

        async def create_engine_for_device(self, udid):
            calls.append(f"create:{udid}")

    ctx.app_state = _AppState()
    result = asyncio.run(device.retry_ddi_mount("UDID-1"))

    assert result == {"status": "retried", "udid": "UDID-1"}
    assert calls == ["terminate:UDID-1", "reset:UDID-1", "create:UDID-1"]


def test_retry_on_disconnected_device_is_404():
    from api import device
    from context import ctx

    ctx.app_state = SimpleNamespace(device_manager=SimpleNamespace(is_connected=lambda _u: False))

    with pytest.raises(HTTPException) as info:
        asyncio.run(device.retry_ddi_mount("UDID-1"))
    assert info.value.status_code == 404
