"""WiFi-tunnel lifecycle — start / status / stop / start-and-connect."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from api._deps import get_device_manager
from api._errors import ErrorCode, http_err, max_devices_error
from api.tunnel._helpers import (
    TeardownStep,
    cancel_watchdog,
    get_watchdog,
    run_teardown_steps,
    set_watchdog,
    validate_local_ip,
)
from config import MAX_DEVICES, REMOTE_PAIRING_PORT
from context import ctx
from services.wifi_tunnel_service import cleanup_wifi_connections, tunnel

logger = logging.getLogger(__name__)
_tunnel_logger = logging.getLogger("wifi_tunnel")

router = APIRouter()


class WifiTunnelStartRequest(BaseModel):
    ip: str
    port: int = Field(default=REMOTE_PAIRING_PORT, ge=1, le=65535)
    udid: str | None = None

    @field_validator("ip")
    @classmethod
    def _check_ip(cls, v: str) -> str:
        return validate_local_ip(v)


async def _tunnel_watchdog(task: asyncio.Task, gen: int) -> None:
    """Watch the tunnel task; if it dies unexpectedly (WiFi blip, iPhone
    locked, admin revoked), clean up any dependent WiFi connections so the
    UI can recover gracefully. A 5s grace window allows the user to restart
    the tunnel before we tear down engines.

    *gen* is the tunnel epoch we were spawned to watch. Comparing the
    live ``tunnel.generation`` against this snapshot survives a
    stop + start cycle inside the grace window — the previous identity
    check against ``tunnel.task`` (which transiently goes None between
    ``stop()`` and the next ``start()``) would have torn down the
    brand-new tunnel's resources by mistake.
    """
    try:
        try:
            await task
        except asyncio.CancelledError:
            return
        except BaseException as exc:
            _tunnel_logger.debug(
                "watchdog: tunnel task raised %s; proceeding to cleanup",
                exc.__class__.__name__, exc_info=True,
            )

        if tunnel.generation != gen:
            _tunnel_logger.info(
                "watchdog: generation mismatch (current=%d, expected=%d); "
                "stale watchdog exiting without cleanup",
                tunnel.generation, gen,
            )
            return

        _tunnel_logger.warning("Tunnel task exited unexpectedly; 5s grace period")
        try:
            from services.ws_broadcaster import broadcast
            await broadcast("tunnel_degraded", {"reason": "task_exited"})
        except Exception:
            _tunnel_logger.exception("Failed to emit tunnel_degraded event")

        await asyncio.sleep(5.0)

        async with tunnel.lock:
            if tunnel.generation != gen:
                _tunnel_logger.info(
                    "watchdog: generation mismatch after grace "
                    "(current=%d, expected=%d); bailing without cleanup",
                    tunnel.generation, gen,
                )
                if tunnel.is_running():
                    try:
                        from services.ws_broadcaster import broadcast
                        await broadcast("tunnel_recovered", {})
                    except Exception as exc:
                        _tunnel_logger.debug(
                            "watchdog: tunnel_recovered broadcast failed (%s)",
                            exc.__class__.__name__, exc_info=True,
                        )
                return
            await cleanup_wifi_connections()
            tunnel.task = None
            tunnel.info = None
            try:
                from services.ws_broadcaster import broadcast
                await broadcast("tunnel_lost", {"reason": "task_exited"})
            except Exception:
                _tunnel_logger.exception("Failed to emit tunnel_lost event")
    except asyncio.CancelledError:
        raise


async def _do_tunnel_start(req: WifiTunnelStartRequest) -> dict:
    """Start an in-process WiFi tunnel. Body of the /wifi/tunnel/start
    route, hoisted out so /wifi/tunnel/start-and-connect can reuse it
    without one route handler calling another (which blurs the routing
    layer + bypasses dependency injection / middleware).
    """
    async with tunnel.lock:
        if tunnel.is_running():
            if tunnel.info:
                return {"status": "already_running", **tunnel.info}
            return {"status": "already_running"}

        resolved_udid = req.udid
        if not resolved_udid:
            try:
                conns = get_device_manager().connected_udids
                if conns:
                    resolved_udid = conns[0]
            except (RuntimeError, AttributeError) as exc:
                _tunnel_logger.debug(
                    "wifi_tunnel_start: could not pre-resolve udid from device manager (%s)",
                    exc.__class__.__name__, exc_info=True,
                )
        if not resolved_udid:
            resolved_udid = "auto"

        _tunnel_logger.info(
            "Starting WiFi tunnel: udid=%s ip=%s port=%d",
            resolved_udid, req.ip, req.port,
        )

        try:
            info = await tunnel.start(resolved_udid, req.ip, req.port, timeout=20.0)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=500,
                detail={"code": ErrorCode.TUNNEL_TIMEOUT.value, "message": "Tunnel startup timed out (20 s)"},
            )
        except Exception:
            logger.exception(
                "Tunnel spawn failed",
                extra={"udid": resolved_udid, "ip": req.ip, "port": req.port},
            )
            raise http_err(500, ErrorCode.TUNNEL_SPAWN_FAILED, "Could not start the tunnel; see the backend log")

        _tunnel_logger.info("WiFi tunnel started: %s", info)
        existing = get_watchdog()
        if existing is None or existing.done():
            set_watchdog(asyncio.create_task(
                _tunnel_watchdog(tunnel.task, tunnel.generation)
            ))
        return {"status": "started", **info}


@router.post("/wifi/tunnel/start")
async def wifi_tunnel_start(req: WifiTunnelStartRequest):
    """Start an in-process WiFi tunnel (requires admin)."""
    return await _do_tunnel_start(req)


@router.get("/wifi/tunnel/status")
async def wifi_tunnel_status():
    """Check if the WiFi tunnel is running."""
    if not tunnel.is_running():
        tunnel.info = None
        return {"running": False}
    return {"running": True, **(tunnel.info or {})}


async def _broadcast_usb_fallback_error(udid: str) -> None:
    from services.ws_broadcaster import broadcast
    await broadcast("device_error", {
        "udid": udid,
        "stage": "usb_fallback",
        "error": "USB fallback engine creation failed",
    })


async def _rollback_usb_fallback(app_state, dm, udid: str) -> None:
    """Undo a partially-completed USB fallback: terminate engine, disconnect,
    notify the frontend. Each sub-step runs as an independent teardown step
    so a failure in one does not skip the others."""
    rollback_steps: list[TeardownStep] = [
        TeardownStep("usb_fallback_terminate_engine",
                     lambda: app_state.terminate_engine(udid)),
        TeardownStep("usb_fallback_disconnect",
                     lambda: dm.disconnect(udid)),
        TeardownStep("usb_fallback_broadcast_error",
                     lambda: _broadcast_usb_fallback_error(udid)),
    ]
    await run_teardown_steps(rollback_steps)


async def _attempt_usb_fallback(app_state, dm) -> None:
    """If a non-Network device is still attached, reconnect it over USB and
    spin up a new simulation engine. On engine-creation failure, roll back
    the half-built connection so the device list never advertises a
    connected device without a backing engine."""
    devices = await dm.discover_devices()
    usb_dev = next((d for d in devices if d.connection_type != "Network"), None)
    if usb_dev is None:
        return

    udid = usb_dev.udid
    try:
        await dm.connect(udid)
    except Exception:
        _tunnel_logger.exception("USB fallback: connect failed for %s", udid)
        return

    try:
        await app_state.create_engine_for_device(udid)
        _tunnel_logger.info("Switched back to USB connection: %s", udid)
    except Exception:
        _tunnel_logger.exception(
            "USB fallback: engine creation failed for %s; rolling back", udid,
        )
        await _rollback_usb_fallback(app_state, dm, udid)


@router.post("/wifi/tunnel/stop")
async def wifi_tunnel_stop():
    """Stop the WiFi tunnel and clean up any network-based device
    connections that were routed through it."""
    app_state = ctx.app_state
    dm = get_device_manager()

    async with tunnel.lock:
        # Always disconnect Network devices first — even when the tunnel
        # isn't running we may still hold stale Network entries.
        await cleanup_wifi_connections()

        if not tunnel.is_running():
            tunnel.info = None
            tunnel.task = None
            return {"status": "not_running"}

        # Order matters: cancel the watchdog *before* tearing down the
        # tunnel so it can't race on our cleanup; then close the tunnel
        # task itself (TunnelRunner.stop encapsulates cancel + await +
        # service/RSD/tunnel-ctx close).
        shutdown_steps: list[TeardownStep] = [
            TeardownStep("cancel_watchdog", cancel_watchdog),
            TeardownStep("tunnel_stop", tunnel.stop),
        ]
        await run_teardown_steps(shutdown_steps)

    # USB fallback runs outside the tunnel lock — it acquires its own
    # device-manager locks and we don't want to hold tunnel.lock across
    # a network/USB discovery + connect roundtrip.
    fallback_steps: list[TeardownStep] = [
        TeardownStep("usb_fallback", lambda: _attempt_usb_fallback(app_state, dm)),
    ]
    await run_teardown_steps(fallback_steps)

    return {"status": "stopped"}


@router.post("/wifi/tunnel/start-and-connect")
async def wifi_tunnel_start_and_connect(req: WifiTunnelStartRequest):
    """Start a WiFi tunnel and immediately connect the device through it."""
    app_state = ctx.app_state

    tunnel_result = await _do_tunnel_start(req)
    if tunnel_result.get("status") not in ("started", "already_running"):
        raise http_err(500, ErrorCode.TUNNEL_FAILED, "Tunnel startup failed")

    rsd_address = tunnel_result.get("rsd_address")
    rsd_port = tunnel_result.get("rsd_port")

    if not rsd_address or not rsd_port:
        raise http_err(500, ErrorCode.TUNNEL_NO_RSD, "Tunnel started but RSD info is missing")

    dm = get_device_manager()
    if dm.connected_count >= MAX_DEVICES:
        raise max_devices_error()
    try:
        info = await dm.connect_wifi_tunnel(rsd_address, rsd_port)
        await app_state.create_engine_for_device(info.udid)
        return {
            "status": "connected",
            "udid": info.udid,
            "name": info.name,
            "ios_version": info.ios_version,
            "connection_type": "Network",
            "rsd_address": rsd_address,
            "rsd_port": rsd_port,
        }
    except Exception:
        logger.exception(
            "Tunnel started but device connection failed",
            extra={"rsd_address": rsd_address, "rsd_port": rsd_port},
        )
        raise http_err(500, ErrorCode.CONNECT_FAILED, "Tunnel started but device connection failed")
