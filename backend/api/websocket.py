from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

import auth
from context import ctx
from models.schemas import JoystickInput
from services.ws_broadcaster import (
    broadcast,
    connection_count,
    register,
    unregister,
)

# Debounce window for the on-connect DVT health probe. Renderer reloads
# fire connect → disconnect → connect within ~30ms; without a window the
# probe races with itself against the same UDID. 1s comfortably covers
# the reload burst without delaying a legitimate user-driven reconnect.
_PROBE_DEBOUNCE_S = 1.0
_last_probe_at: dict[str, float] = {}

# Strong refs to in-flight DVT probes so asyncio doesn't GC them mid-run.
# Tasks self-remove on completion via the done callback below.
_probe_tasks: set[asyncio.Task] = set()

# Re-export broadcast so existing call sites that still use
# ``from api.websocket import broadcast`` keep compiling during the
# migration to services.ws_broadcaster. New code should import from
# services.ws_broadcaster directly so core/ never has to reach back
# into api/ — see tools/check_layers.py.
__all__ = ["broadcast", "router"]

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)

# Close codes we use for auth failures. 4001 is in the app-specific
# range (4000-4999) and distinct from the standard codes, so the
# renderer can distinguish "auth failed, stop reconnecting" from a
# generic disconnect.
_WS_AUTH_FAIL_CODE = 4001
_WS_AUTH_TIMEOUT_SECONDS = 5.0


async def _probe_dvt_health_one(udid: str) -> bool:
    """Best-effort DVT instrument health check for *udid*.

    Returns ``False`` only when the DVT channel is provably dead so the
    caller can mark the device DEGRADED via
    :func:`services.connection_state.mark_degraded`, which fires the
    existing :meth:`DvtLocationService._reconnect` ladder. Returns
    ``True`` on success **and** on any "can't safely probe" case (no
    connection record yet, iOS < 17 legacy service, unknown probe
    failure) so we never false-positive into a flapping device pill.
    """
    try:
        dm = ctx.app_state.device_manager
        conn = dm.get_connection(udid)
    except Exception:
        return True
    if conn is None or getattr(conn, "location_service", None) is None:
        return True
    loc = conn.location_service
    # Only DvtLocationService (iOS 17+) is vulnerable to the silent
    # idle-DVT-channel close this probe exists to catch. Legacy iOS
    # devices use a different transport with different failure modes.
    ensure = getattr(loc, "_ensure_instrument", None)
    if ensure is None:
        return True
    # Late import — ws module loads before location_service in some
    # paths during cold start (tests patch ctx.app_state), and a
    # top-level import would leak that ordering hazard back into
    # production. Inside the function it's a one-time pyc dict lookup.
    from pymobiledevice3.exceptions import ConnectionTerminatedError
    try:
        # Wrap in a short timeout so a wedged DVT handshake can't pin
        # the probe task forever. The legitimate happy-path completes
        # in <100ms; a dead channel fails fast (connection refused / EOF).
        lock = getattr(loc, "_reconnect_lock", None)
        async def _guarded_ensure():
            if lock is not None:
                async with lock:
                    await ensure()
            else:
                await ensure()
        await asyncio.wait_for(_guarded_ensure(), timeout=5.0)
        return True
    except (ConnectionTerminatedError, OSError, EOFError, BrokenPipeError,
            ConnectionResetError, TimeoutError, asyncio.TimeoutError) as exc:
        logger.info(
            "WS connect DVT probe for %s failed (%s); marking degraded",
            udid, type(exc).__name__,
        )
        return False
    except Exception:
        # Unknown probe error — log but don't downgrade the device.
        # Spurious failures here would flap the UI for no reason.
        logger.debug("WS connect DVT probe for %s raised", udid, exc_info=True)
        return True


async def _probe_transport_alive_one(udid: str, conn_type: str) -> bool:
    """Transport-level liveness check for *udid*.

    Returns ``False`` only when the underlying transport is provably
    dead. Closes the gap before usbmux_presence_watchdog (~3s) and
    tunnel_liveness_loop (~15s) catch a freshly-dropped device. Without
    this, a renderer reload inside that window leaves the snapshot
    painting a phantom "connected" pill — the cached DVT instrument
    check is a no-op once :attr:`DvtLocationService._location_sim` is
    populated, so it can't catch this on its own.

    Network: the WiFi tunnel must (a) be running, (b) have RSD info,
    (c) report :meth:`TunnelRunner.transport_alive` true. Any of those
    failing means pymobiledevice3 silently dropped the underlying read
    tasks and the data path is dead.

    USB: the device must appear in :func:`pymobiledevice3.usbmux.list_devices`.
    Failure to reach usbmuxd at all falls back to "alive" so a usbmux
    blip never disconnects every USB device on a WS reconnect.
    """
    if conn_type == "Network":
        from services.wifi_tunnel_service import tunnel
        if not tunnel.is_running() or tunnel.info is None:
            return False
        if hasattr(tunnel, "transport_alive") and not tunnel.transport_alive():
            return False
        return True
    if conn_type == "USB":
        try:
            from pymobiledevice3.usbmux import list_devices
            raw = await asyncio.wait_for(list_devices(), timeout=2.0)
        except Exception:
            return True
        present = {getattr(r, "serial", None) for r in raw if getattr(r, "connection_type", "USB") == "USB"}
        return udid in present
    return True


async def _probe_connected_devices(udids: list[str]) -> None:
    """Background task: probe each UDID's transport + DVT channel and
    reconcile :mod:`services.connection_state` with the truth.

    Runs concurrently with the WS handshake so the renderer never waits
    for I/O on connect. Two layers, in order:

      1. **Transport** — TCP / usbmux round-trip. Provably-dead transport
         routes through :func:`connection_state.disconnect_device` so the
         SSoT broadcasts ``device_disconnected`` immediately instead of
         waiting for the watchdog cadence.
      2. **DVT channel** — the existing :func:`_probe_dvt_health_one`.
         Failure here is the "transport alive but DVT channel dropped"
         case (brief screen-lock, instrument idle-close); we mark
         DEGRADED so :meth:`DvtLocationService._reconnect` picks it up
         on the next teleport.
    """
    from services import connection_state
    from services.location_service import DeviceLostCause

    app_state = ctx.app_state
    dm = getattr(app_state, "device_manager", None)

    for udid in udids:
        try:
            # Resolve connection_type defensively. Real DeviceManager
            # returns "USB" / "Network"; test stubs that pre-date this
            # path return a MagicMock — ``isinstance`` filters those out
            # so we skip transport probing and fall through to DVT-only.
            conn_type: str | None = None
            if dm is not None:
                try:
                    raw_type = dm.get_connection_type(udid)
                except Exception:
                    raw_type = None
                if isinstance(raw_type, str) and raw_type in ("USB", "Network"):
                    conn_type = raw_type

            if conn_type is not None and not await _probe_transport_alive_one(
                udid, conn_type,
            ):
                logger.info(
                    "WS connect transport probe: %s (%s) reports dead — "
                    "disconnecting",
                    udid, conn_type,
                )
                # Engine teardown before transport teardown, mirroring
                # cleanup_wifi_connections + usbmux_presence_watchdog.
                terminate = getattr(app_state, "terminate_engine", None)
                if terminate is not None:
                    try:
                        await terminate(udid)
                    except Exception:
                        logger.exception(
                            "WS connect probe: terminate_engine for %s failed",
                            udid,
                        )
                cause = (
                    DeviceLostCause.WIFI_DROPPED.value
                    if conn_type == "Network"
                    else DeviceLostCause.USB_REMOVED.value
                )
                await connection_state.disconnect_device(dm, udid, cause=cause)
                continue

            if not await _probe_dvt_health_one(udid):
                await connection_state.mark_degraded(
                    udid, cause="dvt_probe_on_connect",
                )
        except Exception:
            logger.exception(
                "WS connect probe task raised for %s", udid,
            )


async def _send_initial_state(ws: WebSocket) -> None:
    """Push current position, cooldown, and device snapshot to a newly
    connected client.

    The ``device_snapshot`` event is the authoritative ground truth for the
    frontend's device list on (re)connect. Without it the renderer would
    keep whatever stale list it had from before the WS drop and show
    phantom "connected" pills until the next REST-poll-driven scan completes
    (~30s worst case).

    Reads from ``connection_state.store`` — the unified SSoT — instead of
    re-running ``discover_devices``. The store caches name / ios_version /
    connection_type from the original connect, so the payload is identical
    without paying a fresh usbmux round-trip on every renderer reload. A
    DEGRADED device also gets a follow-up ``tunnel_degraded`` so the new
    client sees the "reconnecting…" hint that earlier clients received as
    a transition event.

    Also kicks off a non-blocking two-layer health probe per connected
    device (debounced by :data:`_PROBE_DEBOUNCE_S` per UDID). The probe
    catches the case where the cached ``CONNECTED`` state is stale —
    e.g. the iPhone left WiFi or was unplugged while the renderer was
    unmounted. Transport-level failure transitions the device to
    DISCONNECTED via :mod:`services.connection_state`; DVT-channel-only
    failure transitions to DEGRADED so the existing
    :meth:`DvtLocationService._reconnect` ladder picks it up.
    """
    from services import connection_state
    from services.connection_state import DeviceState

    app_state = ctx.app_state
    # Current position from any active engine
    for engine in app_state.simulation_engines.values():
        pos = engine.current_position
        if pos:
            await ws.send_text(json.dumps({
                "type": "position_update",
                "data": {"lat": pos.lat, "lng": pos.lng},
            }))
            break
    # Cooldown state
    cd = app_state.cooldown_timer.get_status()
    await ws.send_text(json.dumps({"type": "cooldown_update", "data": cd}))

    # Device snapshot — pulled directly from the unified state store. Both
    # CONNECTED and DEGRADED count as "this device exists" for the list;
    # DEGRADED additionally gets a tunnel_degraded follow-up below.
    snapshot = connection_state.store.snapshot()
    connected: list[dict[str, str]] = []
    degraded_udids: list[str] = []
    for udid, state in snapshot.items():
        if state not in (DeviceState.CONNECTED, DeviceState.DEGRADED):
            continue
        md = connection_state.store.metadata_for(udid)
        connected.append({
            "udid": udid,
            "name": md.get("name", ""),
            "ios_version": md.get("ios_version", ""),
            "connection_type": md.get("connection_type", "USB"),
        })
        if state == DeviceState.DEGRADED:
            degraded_udids.append(udid)

    await ws.send_text(json.dumps({
        "type": "device_snapshot",
        "data": {"devices": connected},
    }))

    # Re-emit tunnel_degraded for any device currently mid-reconnect so the
    # fresh client's chip shows the same "reconnecting…" hint other clients
    # already have. The store doesn't remember the original cause string,
    # so we use a generic "snapshot" tag — the renderer cares about the
    # event, not the reason text.
    for udid in degraded_udids:
        await ws.send_text(json.dumps({
            "type": "tunnel_degraded",
            "data": {"udid": udid, "reason": "snapshot"},
        }))

    # Kick off a debounced DVT health probe per CONNECTED udid. Skipped
    # entirely when no DeviceManager is wired up (test stubs) so existing
    # ``test_websocket_initial_state`` cases stay deterministic.
    if getattr(app_state, "device_manager", None) is None:
        return
    now = time.monotonic()
    probe_targets: list[str] = []
    for entry in connected:
        udid = entry["udid"]
        last = _last_probe_at.get(udid)
        if last is not None and now - last < _PROBE_DEBOUNCE_S:
            continue
        _last_probe_at[udid] = now
        probe_targets.append(udid)
    if probe_targets:
        task = asyncio.create_task(_probe_connected_devices(probe_targets))
        _probe_tasks.add(task)
        task.add_done_callback(_probe_tasks.discard)


async def _require_auth_frame(ws: WebSocket) -> bool:
    """Consume the first incoming frame and validate the session token.

    Returns True if the client is authenticated (or auth is disabled in
    dev mode) and the socket should remain open. Returns False after
    closing the socket with 4001 on any failure.
    """
    if auth._is_auth_disabled():
        return True
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=_WS_AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        await ws.close(code=_WS_AUTH_FAIL_CODE, reason="auth timeout")
        return False
    except WebSocketDisconnect:
        return False
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await ws.close(code=_WS_AUTH_FAIL_CODE, reason="bad auth frame")
        return False
    supplied = msg.get("token", "") if msg.get("type") == "auth" else ""
    if not auth.API_TOKEN or not secrets.compare_digest(str(supplied), auth.API_TOKEN):
        await ws.close(code=_WS_AUTH_FAIL_CODE, reason="auth rejected")
        return False
    return True


@router.websocket("/ws/status")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    if not await _require_auth_frame(ws):
        return
    register(ws)
    logger.info("WebSocket client connected (%d total)", connection_count())

    try:
        await _send_initial_state(ws)
    except Exception:
        logger.debug("Failed to send initial state to new WS client", exc_info=True)

    try:
        while True:
            text = await ws.receive_text()
            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "joystick_input":
                data = msg.get("data", {})
                app_state = ctx.app_state
                # Route per-udid if provided; otherwise fan out to all engines.
                udid = msg.get("udid") or data.get("udid")
                # JoystickInput enforces strict bounds (direction 0–360,
                # intensity 0–1, sensitivity 0.1–2.0). A malformed frame
                # must be dropped — letting the ValidationError escape to
                # the outer `except Exception` would kill the receive
                # loop and starve the client of all events until it
                # reconnects.
                try:
                    inp = JoystickInput(
                        direction=data.get("direction", 0),
                        intensity=data.get("intensity", 0),
                        sensitivity=data.get("sensitivity", 1.0),
                    )
                except (ValidationError, TypeError):
                    logger.debug("Dropping malformed joystick_input frame: %s", text)
                    continue
                if udid:
                    engine = app_state.get_engine(udid)
                    if engine:
                        engine.joystick_move(inp)
                else:
                    for engine in list(app_state.simulation_engines.values()):
                        engine.joystick_move(inp)

            elif msg_type == "joystick_stop":
                app_state = ctx.app_state
                udid = msg.get("udid") or msg.get("data", {}).get("udid")
                if udid:
                    engine = app_state.get_engine(udid)
                    if engine:
                        await engine.joystick_stop()
                else:
                    for engine in list(app_state.simulation_engines.values()):
                        await engine.joystick_stop()

    except WebSocketDisconnect:
        pass
    except RuntimeError as e:
        # Starlette raises "WebSocket is not connected" instead of
        # WebSocketDisconnect when the client cuts the TCP stream
        # mid-frame (page reload, hot-restart, abrupt close). Treat
        # as a normal disconnect so it doesn't pollute the error log.
        msg = str(e)
        if "not connected" in msg or 'call "accept"' in msg:
            logger.debug("WebSocket disconnected mid-frame: %s", e)
        else:
            logger.error("WebSocket runtime error: %s", e)
    except Exception as e:
        logger.error("WebSocket error: %s", e)
    finally:
        unregister(ws)
        logger.info("WebSocket client disconnected (%d remaining)", connection_count())
