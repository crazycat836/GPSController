"""Forget-device ("移除配對") flow — device-side unpair + pair-record cleanup.

Lives in core per :mod:`core.device_manager`'s contract ("wraps
pymobiledevice3 internals so the rest of the application never touches
low-level device APIs"): lockdown ``unpair()`` selection, OS-specific
pair-record paths, the usbmuxd ``DeletePairRecord`` call, and the
three-way success aggregation all happen here. The route in
``api/device.py`` only translates :class:`ForgetResult` /
:class:`ForgetFailedError` into the HTTP response.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from core.device_utils import (
    delete_usbmux_pair_record,
    purge_stale_remote_pair_record,
)
from services import connection_state

logger = logging.getLogger(__name__)


class ForgetFailedError(RuntimeError):
    """Every forget path failed (device-side unpair, usbmuxd
    DeletePairRecord, and local file removal) while there was something
    to clean. The API layer maps this to ``500 forget_failed``."""


@dataclass(frozen=True)
class ForgetResult:
    """Outcome of a forget-device flow, one field per cleanup channel."""

    status: str
    device_unpaired: bool
    usbmux_record_deleted: bool
    removed: list[str]
    failed: list[dict[str, str]]


def _pair_record_candidates(udid: str) -> list[Path]:
    """Return every OS-specific path the lockdown pair-record for *udid*
    could live at. We try them all on forget so a stale record doesn't
    survive in a fallback location."""
    if sys.platform == "win32":
        base = Path(os.environ.get("ALLUSERSPROFILE", "C:/ProgramData")) / "Apple" / "Lockdown"
        return [base / f"{udid}.plist"]
    # macOS + Linux: try system-wide first, then user-level.
    return [
        Path("/var/db/lockdown") / f"{udid}.plist",
        Path("/var/lib/lockdown") / f"{udid}.plist",
        Path.home() / "Library" / "Lockdown" / f"{udid}.plist",
    ]


def _lockdown_with_unpair(conn) -> object | None:
    """Return the lockdown client that can issue a device-side ``unpair()``.

    For iOS 17+, ``conn.lockdown`` is a ``RemoteServiceDiscoveryService``
    (RSD) — it has NO ``unpair()`` — while the real USB ``LockdownClient``
    is kept in ``conn.usbmux_lockdown``. The earlier code called
    ``conn.lockdown.unpair()`` and raised ``AttributeError`` for every
    iOS 17+ device, so the device was never actually untrusted. Prefer the
    LockdownClient; fall back to ``conn.lockdown`` for the iOS 16 legacy
    path where it *is* the LockdownClient.
    """
    for client in (getattr(conn, "usbmux_lockdown", None), getattr(conn, "lockdown", None)):
        if client is not None and hasattr(client, "unpair"):
            return client
    return None


def _remove_pair_record_files(udid: str) -> tuple[list[str], list[dict[str, str]]]:
    """Best-effort delete of the local lockdown pair-record files.

    One syscall per candidate — atomic, no TOCTOU. FileNotFoundError means
    the path is already absent (fine); other OSErrors are tracked. On macOS
    ``/var/db/lockdown`` is OS-protected and ``unlink`` raises
    ``PermissionError`` even as root — that's why this is best-effort and
    the authoritative "forget" is the device-side ``unpair()`` in the
    caller, not these files.
    """
    removed: list[str] = []
    failed: list[dict[str, str]] = []
    for p in _pair_record_candidates(udid):
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.warning("Could not remove pair record %s", p, exc_info=True)
            failed.append({"path": str(p), "error": getattr(exc, "strerror", None) or str(exc)})
        else:
            removed.append(str(p))
    return removed, failed


async def _unpair_connected_device(app_state, dm, udid: str) -> bool:
    """Device-side unpair + engine teardown + transport disconnect for a
    currently-connected *udid*. Returns whether the device-side
    ``unpair()`` actually landed."""
    conn = dm.get_connection(udid)
    if conn is None:
        return False

    device_unpaired = False
    unpair_client = _lockdown_with_unpair(conn)

    async def _unpair() -> None:
        # unpair() may be sync or async depending on the client —
        # normalise both to a coroutine.
        result = unpair_client.unpair()
        if asyncio.iscoroutine(result):
            await result

    if unpair_client is not None:
        # Run the device-side unpair in parallel with the local engine
        # teardown — they touch different resources and the unpair RPC
        # is the long pole.
        unpair_task = asyncio.create_task(_unpair())
        await app_state.terminate_engine(udid)
        try:
            await unpair_task
            device_unpaired = True
        except Exception:
            logger.warning(
                "unpair() failed for %s; will still remove local records",
                udid, exc_info=True,
            )
    else:
        # No LockdownClient available (e.g. a pure WiFi-tunnel device
        # never connected over USB) — we can't issue a device-side
        # unpair. Fall through to local cleanup and surface the gap.
        await app_state.terminate_engine(udid)
        logger.warning(
            "No USB lockdown client for %s; cannot issue a device-side "
            "unpair — connect it over USB to fully untrust this computer",
            udid,
        )
    # Routed through connection_state so the WS observer broadcasts
    # ``device_disconnected`` with cause="forget" exactly once.
    await connection_state.disconnect_device(dm, udid, cause="forget")
    return device_unpaired


async def forget_device(app_state, dm, udid: str) -> ForgetResult:
    """Forget a paired device — disconnects it (if connected), tells the
    device to drop our pair record, and removes the local cached record.

    After this, the iPhone/iPad shows "Trust This Computer" again the next
    time it connects. The device-side ``unpair()`` (issued through
    lockdownd over USB) is the authoritative action; the local file removal
    is best-effort because macOS protects ``/var/db/lockdown``.

    Raises :class:`ForgetFailedError` only when every path failed AND
    there was something to clean.
    """
    device_unpaired = await _unpair_connected_device(app_state, dm, udid)

    # Authoritative host-side unpair: ask usbmuxd to drop its stored pair
    # record. This is what makes forget work in the cases the device-side
    # unpair can't — device on WiFi, unplugged, or locked (a locked device
    # makes lockdownd's unpair raise PasswordRequiredError) — and it
    # deletes the macOS-protected /var/db/lockdown record that os.unlink
    # below can't touch even as root. Done before the file sweep so that
    # sweep becomes a clean no-op once usbmuxd has removed the record.
    host_record_deleted = await delete_usbmux_pair_record(udid)

    # iOS 17+ RemotePairing record (~/.pymobiledevice3) — best-effort so a
    # later WiFi-tunnel re-pair starts from a clean slate.
    purge_stale_remote_pair_record(udid)

    # Best-effort direct file removal for records usbmuxd doesn't manage
    # (Windows/Linux, user-level macOS records).
    removed, failed = _remove_pair_record_files(udid)

    # device_disconnected broadcast already happened in disconnect_device
    # above — no need to fire it again here.

    # The forget genuinely succeeded if ANY authoritative step landed: the
    # device-side unpair, the usbmuxd record delete, or a local file removal.
    # Only hard-fail when every path failed AND there was something to clean.
    forgotten = device_unpaired or host_record_deleted or bool(removed)
    if not forgotten and failed:
        logger.error(
            "Forget device %s failed: device-side unpair, usbmuxd "
            "DeletePairRecord, and local file removal all failed "
            "(%d file(s) attempted)", udid, len(failed),
        )
        raise ForgetFailedError(f"every forget path failed for {udid}")

    status = "forgotten" if (forgotten or not failed) else "partial"
    logger.info(
        "Forgot device %s (status=%s, device_unpaired=%s, usbmux_deleted=%s, "
        "removed %d, failed %d file(s))",
        udid, status, device_unpaired, host_record_deleted, len(removed), len(failed),
    )
    return ForgetResult(
        status=status,
        device_unpaired=device_unpaired,
        usbmux_record_deleted=host_record_deleted,
        removed=removed,
        failed=failed,
    )
