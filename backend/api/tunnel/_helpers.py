"""Tunnel-handshake + teardown primitives shared by /api/device/wifi/*.

Provides:
  * iOS 17+ RemotePairing handshake (proxy → tunnel → RSD → service
    over USB lockdown) with idempotent resource teardown.
  * Ordered teardown-step runner that swallows per-step errors so a
    failure in one step doesn't skip the rest.
  * ``validate_local_ip`` — SSRF guard: only loopback / RFC1918 /
    link-local addresses may reach the tunnel endpoints.
  * Module-level watchdog handle (``get_watchdog`` / ``set_watchdog`` /
    ``cancel_watchdog``) — singleton because ``TunnelRunner`` itself is
    process-wide.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TypedDict

from fastapi import HTTPException

from api._errors import ErrorCode, http_err

_tunnel_logger = logging.getLogger("wifi_tunnel")
logger = logging.getLogger(__name__)

# Watchdog task handle (module-level since TunnelRunner is process-wide).
_tunnel_watchdog_task: "asyncio.Task | None" = None


def get_watchdog() -> "asyncio.Task | None":
    return _tunnel_watchdog_task


def set_watchdog(task: "asyncio.Task | None") -> None:
    global _tunnel_watchdog_task
    _tunnel_watchdog_task = task


class RemotePairResources(TypedDict):
    """Closeable handles opened during the iOS 17+ RemotePairing handshake.

    Constructed with all four keys set to ``None`` and progressively
    populated as each handshake step succeeds. Teardown reads each entry
    back and closes whatever was opened, so a partial handshake still
    cleans up.
    """
    proxy: object | None
    tunnel_ctx: object | None
    rsd: object | None
    tunnel_svc: object | None


@dataclass(frozen=True)
class TeardownStep:
    """One ordered step in a tunnel teardown / fallback rollback chain.

    `name` shows up in debug logs when the step raises. `fn` may be sync or
    async — :func:`run_teardown_steps` awaits the result if it's a coroutine.
    """
    name: str
    fn: Callable[[], Awaitable[None] | None]


async def run_teardown_steps(steps: list[TeardownStep]) -> list[dict[str, str]]:
    """Run *steps* in order with a single flat try/except per step.

    Errors are collected (for callers that want to inspect or surface them)
    and logged at DEBUG with `exc_info=True` — preserving this module's
    silent-`except` discipline. `asyncio.CancelledError` is treated as
    expected (e.g. the cancel-and-await teardown step) and never collected.
    """
    errors: list[dict[str, str]] = []
    for step in steps:
        try:
            result = step.fn()
            if asyncio.iscoroutine(result):
                await result
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            errors.append({"step": step.name, "error": str(exc)})
            _tunnel_logger.debug(
                "Teardown step %s failed", step.name, exc_info=True,
            )
    return errors


def validate_local_ip(value: str) -> str:
    """Reject non-IP strings and addresses outside the loopback / RFC1918 /
    link-local ranges. The tunnel endpoints should only ever reach an
    iPhone on the same LAN — anything else points at SSRF.
    """
    try:
        addr = ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValueError("invalid IP address") from exc
    if not (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
    ):
        raise ValueError("address must be loopback / private / link-local")
    return str(addr)


def purge_stale_remote_pair_record(udid: str) -> None:
    """Best-effort delete of the cached RemotePairing record for *udid*.

    Required so RemotePairingProtocol.connect() can't short-circuit through
    a corrupt cached record and skip the actual _pair() handshake.
    """
    try:
        from pymobiledevice3.common import get_home_folder
        from pymobiledevice3.pair_records import (
            PAIRING_RECORD_EXT,
            get_remote_pairing_record_filename,
        )
        stale = get_home_folder() / f"{get_remote_pairing_record_filename(udid)}.{PAIRING_RECORD_EXT}"
        if stale.exists():
            stale.unlink()
            _tunnel_logger.info("Re-pair: removed stale remote pair record %s", stale)
    except Exception:
        _tunnel_logger.debug("Re-pair: could not check/remove stale pair record", exc_info=True)


async def perform_remote_pair_handshake(
    lockdown,
    udid: str,
    ios_version: str,
    resources: RemotePairResources,
) -> bool:
    """Run the iOS 17+ RemotePairing handshake and return whether the pair
    record was regenerated.

    Populates *resources* (mutable dict shared with the caller) as each step
    succeeds, so the caller's finally can close whatever was opened — even
    when this function raises mid-way.

    Raises a structured HTTPException on handshake failure, mapping
    pymobiledevice3's typed exceptions to user-friendly messages.
    """
    from pymobiledevice3.remote.tunnel_service import (
        CoreDeviceTunnelProxy,
        create_core_device_tunnel_service_using_rsd,
    )
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService

    purge_stale_remote_pair_record(udid)

    try:
        resources["proxy"] = await CoreDeviceTunnelProxy.create(lockdown)
        resources["tunnel_ctx"] = resources["proxy"].start_tcp_tunnel()
        tunnel_result = await resources["tunnel_ctx"].__aenter__()

        resources["rsd"] = RemoteServiceDiscoveryService((tunnel_result.address, tunnel_result.port))
        await resources["rsd"].connect()

        _tunnel_logger.info(
            "Re-pair: opening CoreDeviceTunnelService over RSD %s:%s — "
            "Trust prompt should appear on iPhone...",
            tunnel_result.address, tunnel_result.port,
        )
        resources["tunnel_svc"] = await create_core_device_tunnel_service_using_rsd(
            resources["rsd"], autopair=True,
        )
        _tunnel_logger.info(
            "Re-pair: CoreDeviceTunnelService connected for %s — RemotePairing record written",
            udid,
        )
        return True
    except Exception as e:
        _tunnel_logger.exception("Re-pair: RemotePairing handshake failed")
        from pymobiledevice3.exceptions import (
            NotPairedError,
            PairingDialogResponsePendingError,
            PairingError,
        )
        if isinstance(e, PairingDialogResponsePendingError):
            friendly = "Tap \"Trust\" on the iPhone unlock screen and retry (the timeout is only a few seconds)."
        elif isinstance(e, (NotPairedError, PairingError)):
            friendly = "USB pairing invalid; unplug and re-plug USB, then tap Trust."
        else:
            friendly = "RemotePairing handshake failed; check the backend log for details."
        raise HTTPException(
            status_code=500,
            detail={
                "code": ErrorCode.REMOTE_PAIR_FAILED.value,
                "message": friendly,
                "udid": udid,
                "ios_version": ios_version,
            },
        )


async def close_remote_pair_resources(resources: RemotePairResources) -> None:
    """Idempotently close every resource opened by the RemotePairing handshake.

    Safe to call when the handshake never started, succeeded fully, or failed
    mid-way — each entry in *resources* may be ``None``. Closers run in
    reverse-open order; close errors are swallowed (logged at DEBUG) so a
    partial teardown can still finish the rest.
    """
    for closer in (
        lambda: resources["tunnel_svc"] and resources["tunnel_svc"].close(),
        lambda: resources["rsd"] and resources["rsd"].close(),
        lambda: resources["tunnel_ctx"] and resources["tunnel_ctx"].__aexit__(None, None, None),
    ):
        try:
            r = closer()
            if asyncio.iscoroutine(r):
                await r
        except Exception as exc:
            _tunnel_logger.debug(
                "Re-pair cleanup: closer raised (%s); ignoring",
                exc.__class__.__name__, exc_info=True,
            )
    try:
        proxy = resources["proxy"]
        if proxy is not None:
            r = proxy.close()
            if asyncio.iscoroutine(r):
                await r
    except Exception as exc:
        _tunnel_logger.debug(
            "Re-pair cleanup: proxy.close() raised (%s); ignoring",
            exc.__class__.__name__, exc_info=True,
        )


async def select_usb_device() -> str:
    """Return the UDID of the first USB-attached iOS device.

    Raises a structured HTTPException when usbmux is unreachable or when no
    USB-connected device is plugged in (Network entries cannot regenerate the
    RemotePairing record).
    """
    from pymobiledevice3.usbmux import list_devices as mux_list_devices
    try:
        raw_devices = await mux_list_devices()
    except Exception:
        logger.exception("usbmux list_devices failed during /wifi/repair")
        raise http_err(500, ErrorCode.USBMUX_UNAVAILABLE, "Could not list USB devices; check that usbmuxd is running")

    usb_dev = next((d for d in raw_devices if getattr(d, "connection_type", "USB") == "USB"), None)
    if usb_dev is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": ErrorCode.REPAIR_NEEDS_USB.value,
                "message": "Please connect the iPhone via USB first. Re-pairing needs USB to trigger the \"Trust This Computer\" prompt.",
            },
        )
    return usb_dev.serial


def cancel_watchdog() -> None:
    """Cancel + drop the module-level watchdog task if it's still alive."""
    task = get_watchdog()
    if task is None or task.done():
        set_watchdog(None)
        return
    task.cancel()
    set_watchdog(None)
