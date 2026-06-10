"""Stateless device helpers extracted from :mod:`core.device_manager`.

These are pure module-level utilities — iOS version parsing and host-side
pair-record management — with no dependency on the ``DeviceManager``
instance. They live here so ``device_manager`` stays under the file-size
budget and these helpers can be unit-tested in isolation.

``core.device_manager`` re-exports every name below, so existing
``from core.device_manager import ...`` call sites (api.device, api._errors,
api.tunnel.pair, tests) keep working unchanged.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class UnsupportedIosVersionError(RuntimeError):
    """Raised when a connecting device's iOS version is below the minimum
    supported by GPSController (currently 16.0). Surfaces a structured error to
    the API layer so the frontend can show an actionable message rather
    than a stack trace."""

    MIN_VERSION = "16.0"

    def __init__(self, version: str) -> None:
        self.version = version
        super().__init__(f"iOS {version} is not supported (requires {self.MIN_VERSION}+)")


def parse_ios_version(version_string: str) -> tuple[int, ...]:
    """Convert an iOS version string like '17.4.1' into a comparable tuple."""
    try:
        return tuple(int(p) for p in version_string.split("."))
    except (ValueError, AttributeError):
        logger.warning("Unable to parse iOS version '%s', assuming 0.0", version_string)
        return (0, 0)


async def delete_usbmux_pair_record(udid: str) -> bool:
    """Ask usbmuxd to delete its stored host pairing record for *udid*.

    This is the authoritative host-side "unpair" — and the only one that
    works in every state:

      * usbmuxd owns the record store (``/var/db/lockdown`` on macOS, which
        the OS refuses to ``unlink`` even as root), so it can delete the
        file we can't.
      * It needs no device interaction, so it succeeds while the device is
        on WiFi, unplugged, or **locked** — a locked device makes
        lockdownd's own ``unpair()`` raise ``PasswordRequiredError``, which
        is exactly why the "device-side unpair only" path failed
        intermittently.

    Once the host record is gone, the next connection re-pairs from scratch
    and the iPhone/iPad shows "Trust This Computer" again.

    pymobiledevice3 exposes ``ReadPairRecord`` / ``SavePairRecord`` but not
    delete, so we send the usbmuxd ``DeletePairRecord`` message directly
    over the same plist mux connection. Returns ``True`` on success;
    ``False`` (logged) if usbmuxd rejects it or the protocol is the older
    binary variant without ``_send_receive``.
    """
    from pymobiledevice3.usbmux import create_mux

    mux = None
    try:
        mux = await create_mux()
        send_receive = getattr(mux, "_send_receive", None)
        if send_receive is None:
            logger.debug(
                "delete_usbmux_pair_record: mux %s has no _send_receive; skipping",
                type(mux).__name__,
            )
            return False
        # usbmuxd is a fast local daemon, but bound the round-trip so a
        # wedged daemon can't hang the forget request forever (the
        # TimeoutError is caught below and degrades to "not deleted").
        await asyncio.wait_for(
            send_receive({"MessageType": "DeletePairRecord", "PairRecordID": udid}),
            timeout=5.0,
        )
        logger.info("usbmuxd DeletePairRecord succeeded for %s", udid)
        return True
    except Exception:
        logger.warning("usbmuxd DeletePairRecord failed for %s", udid, exc_info=True)
        return False
    finally:
        if mux is not None:
            try:
                result = mux.close()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.debug("delete_usbmux_pair_record: mux.close() raised", exc_info=True)


