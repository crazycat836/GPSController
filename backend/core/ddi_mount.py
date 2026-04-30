"""
GPSController DDI mount + location-service factory helpers.

Extracted from ``device_manager.py`` to keep that hub focused on
connection lifecycle. This module owns:

* Personalized Developer Disk Image mounting for iOS 17+ devices
  (the ``auto_mount_personalized`` wrapper, with timeout + cross-device
  serialisation + frontend broadcasts).
* Best-effort classic Developer Disk Image mounting for iOS 16.x.
* The ``DvtProvider`` / ``LegacyLocationService`` factory functions
  that depend on a mounted DDI.

All functions are free functions taking the live connection record and
collaborators (lock, broadcasters) explicitly. ``DeviceManager`` calls
into them; they never reach back. This minimises coupling and keeps the
DDI/DVT failure paths unit-testable in isolation.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider

from services.location_service import (
    DvtLocationService,
    LegacyLocationService,
)

if TYPE_CHECKING:
    from core.device_manager import _ActiveConnection


logger = logging.getLogger(__name__)


async def broadcast_ddi_mount_failure(udid: str, stage: str, reason: str) -> None:
    """Emit the structured failure pair the frontend expects.

    ``ddi_mount_missing`` drives the user-facing hint toast;
    ``ddi_mount_failed`` is the legacy event name retained for
    downstream consumers. Both carry the same fields so either can be
    handled consistently.
    """
    try:
        from api.websocket import broadcast
        payload = {
            "udid": udid,
            "stage": stage,
            "reason": reason,
            "hint_key": "ddi.missing_hint",
        }
        await broadcast("ddi_mount_missing", payload)
        await broadcast("ddi_mount_failed", {**payload, "error": reason})
    except Exception:
        logger.debug("ddi broadcast failed", exc_info=True)


async def ensure_personalized_ddi_mounted(
    conn: "_ActiveConnection", mount_lock: asyncio.Lock
) -> None:
    """For iOS 17+ devices, make sure the Personalized Developer Disk Image
    is mounted. Without the DDI, the DVT service hub won't advertise and
    DvtProvider will fail with "No such service: com.apple.instruments.dtservicehub".

    If already mounted, this is a no-op. Otherwise it downloads the image
    from the pymobiledevice3 DDI repository (GitHub) and mounts it. The
    per-device signing (TSS) is handled internally by pymobiledevice3.
    """
    try:
        from pymobiledevice3.services.mobile_image_mounter import (
            MobileImageMounterService,
            auto_mount_personalized,
            AlreadyMountedError,
        )
    except ImportError as exc:
        logger.warning(
            "pymobiledevice3.mobile_image_mounter not importable (%s: %s); "
            "skipping DDI mount",
            type(exc).__name__, exc,
        )
        return

    # 1. Check whether a Personalized image is already mounted.
    try:
        mounter = MobileImageMounterService(lockdown=conn.lockdown)
        try:
            await mounter.connect()
            if await mounter.is_image_mounted("Personalized"):
                logger.debug("Personalized DDI already mounted on %s", conn.udid)
                return
        finally:
            try:
                await mounter.close()
            except Exception:
                pass
    except Exception:
        logger.warning("Could not query image mount status; will attempt to mount anyway", exc_info=True)

    # 2. Not mounted — download + mount. Notify frontend so the user
    # sees a "preparing device" overlay instead of a frozen UI.
    logger.info("Personalized DDI not mounted on %s; mounting (may download ~20MB)...", conn.udid)
    try:
        from api.websocket import broadcast
        await broadcast("ddi_mounting", {"udid": conn.udid})
    except Exception:
        pass
    mount_succeeded = False
    try:
        # auto_mount_personalized is a coroutine that talks to the device
        # over the same lockdown connection — its async resources are
        # bound to the running event loop, so it MUST run on the main
        # loop. We previously delegated this to a thread executor via
        # asyncio.run(...) to keep the loop responsive during the GitHub
        # DDI download, but that hits "Future attached to a different
        # loop" because lockdown sockets/futures stay tied to the main
        # loop. Trade-off: the GitHub fetch may briefly stall the loop
        # for a couple of seconds — acceptable vs. a hard crash.
        # Serialise across devices so parallel connects don't corrupt
        # the shared DDI cache.
        async with mount_lock:
            await asyncio.wait_for(
                auto_mount_personalized(conn.lockdown), timeout=120.0,
            )
        logger.info("Personalized DDI mounted successfully for %s", conn.udid)
        mount_succeeded = True
    except AlreadyMountedError:
        logger.info("DDI was mounted concurrently for %s", conn.udid)
        mount_succeeded = True
    except asyncio.TimeoutError:
        logger.error("DDI mount timed out after 120s for %s", conn.udid)
        await broadcast_ddi_mount_failure(
            conn.udid, "personalized",
            "TimeoutError: DDI download/mount timed out after 120s",
        )
        raise RuntimeError("DDI mount timed out — check network access to github.com")
    except Exception as exc:
        logger.exception("auto_mount_personalized failed for %s", conn.udid)
        await broadcast_ddi_mount_failure(
            conn.udid, "personalized", f"{type(exc).__name__}: {exc}",
        )
        raise
    finally:
        if mount_succeeded:
            try:
                from api.websocket import broadcast
                await broadcast("ddi_mounted", {"udid": conn.udid})
            except Exception:
                pass


async def ensure_classic_ddi_mounted(conn: "_ActiveConnection") -> None:
    """Best-effort Developer Disk Image mount for iOS 16.x devices."""
    try:
        import pymobiledevice3.services.mobile_image_mounter as mim
    except ImportError as exc:
        logger.warning(
            "pymobiledevice3.mobile_image_mounter not importable (%s: %s); "
            "skipping classic DDI mount",
            type(exc).__name__, exc,
        )
        return

    mounter_cls = getattr(mim, "MobileImageMounterService", None)
    if mounter_cls is not None:
        try:
            mounter = mounter_cls(lockdown=conn.lockdown)
            try:
                await mounter.connect()
                if await mounter.is_image_mounted("Developer"):
                    logger.debug("Classic DDI already mounted on %s", conn.udid)
                    return
            finally:
                try:
                    await mounter.close()
                except Exception:
                    pass
        except Exception:
            logger.warning("Could not query classic DDI mount state", exc_info=True)

    mount_fn = None
    for name in ("auto_mount_developer", "auto_mount", "auto_mount_disk_image"):
        candidate = getattr(mim, name, None)
        if callable(candidate):
            mount_fn = candidate
            break
    if mount_fn is None:
        logger.warning("No classic DDI auto-mount helper found; continuing without mount")
        return

    logger.info("Classic DDI not mounted on %s; attempting auto-mount", conn.udid)
    try:
        from api.websocket import broadcast
        await broadcast("ddi_mounting", {"udid": conn.udid})
    except Exception:
        pass

    mounted = False
    failure_reason: str | None = None
    try:
        await asyncio.wait_for(mount_fn(conn.lockdown), timeout=120.0)
        mounted = True
        logger.info("Classic DDI mounted successfully for %s", conn.udid)
    except Exception as exc:
        failure_reason = f"{type(exc).__name__}: {exc}"
        logger.warning("Classic DDI auto-mount failed for %s", conn.udid, exc_info=True)
    finally:
        if mounted:
            try:
                from api.websocket import broadcast
                await broadcast("ddi_mounted", {"udid": conn.udid})
            except Exception:
                pass
        else:
            await broadcast_ddi_mount_failure(
                conn.udid, "classic",
                failure_reason or "Classic DDI mount failed",
            )


async def create_dvt_location_service(
    conn: "_ActiveConnection", mount_lock: asyncio.Lock
) -> DvtLocationService:
    """Spin up a DVT provider and hand it to ``DvtLocationService``.

    If DVT fails because the Developer Disk Image is not mounted,
    we try to mount it automatically and retry once.
    """
    # Try to mount DDI proactively (fast no-op when already mounted).
    try:
        await ensure_personalized_ddi_mounted(conn, mount_lock)
    except Exception:
        logger.warning("DDI auto-mount failed; DVT may still fail", exc_info=True)

    try:
        dvt = DvtProvider(conn.lockdown)
        await dvt.__aenter__()
        conn.dvt_provider = dvt
        logger.debug("DVT provider opened for %s", conn.udid)
        return DvtLocationService(dvt, lockdown=conn.lockdown)
    except Exception as dvt_exc:
        logger.warning(
            "DVT location service failed for %s (%s). Falling back to "
            "legacy DtSimulateLocation over lockdown.",
            conn.udid, dvt_exc,
        )
        # iOS 17+ still exposes com.apple.dt.simulatelocation on some
        # devices (reported working on iOS 26 by multiple users), so
        # try the legacy service before giving up entirely.
        try:
            # Prefer the original usbmux/TCP lockdown for DtSimulateLocation;
            # fall back to whatever we have stored if not available.
            legacy_lockdown = conn.usbmux_lockdown or conn.lockdown
            legacy = LegacyLocationService(legacy_lockdown)
            logger.info("Using LegacyLocationService fallback for %s", conn.udid)
            return legacy
        except Exception:
            logger.exception(
                "Both DVT and legacy location services failed for %s", conn.udid
            )
            raise dvt_exc


async def create_legacy_location_service(
    conn: "_ActiveConnection",
) -> LegacyLocationService:
    """Build the legacy location service for iOS 16.x devices."""
    try:
        await ensure_classic_ddi_mounted(conn)
    except Exception:
        logger.warning("Classic DDI auto-mount failed; legacy location may still fail", exc_info=True)
    logger.info("Using LegacyLocationService for %s", conn.udid)
    return LegacyLocationService(conn.lockdown)
