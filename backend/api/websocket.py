import asyncio
import json
import logging
import secrets

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from context import ctx
from models.schemas import JoystickInput

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)

# Close codes we use for auth failures. 4001 is in the app-specific
# range (4000-4999) and distinct from the standard codes, so the
# renderer can distinguish "auth failed, stop reconnecting" from a
# generic disconnect.
_WS_AUTH_FAIL_CODE = 4001
_WS_AUTH_TIMEOUT_SECONDS = 5.0

# Active WebSocket connections
_connections: list[WebSocket] = []


async def broadcast(event_type: str, data: dict):
    """Broadcast event to all connected WebSocket clients."""
    message = json.dumps({"type": event_type, "data": data})
    dead = []
    for ws in _connections:
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _connections.remove(ws)


async def _send_initial_state(ws: WebSocket) -> None:
    """Push current position and cooldown to a newly connected client."""
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


async def _require_auth_frame(ws: WebSocket) -> bool:
    """Consume the first incoming frame and validate the session token.

    Returns True if the client is authenticated (or auth is disabled in
    dev mode) and the socket should remain open. Returns False after
    closing the socket with 4001 on any failure.
    """
    import main as _main
    if _main._is_auth_disabled():
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
    if not _main.API_TOKEN or not secrets.compare_digest(str(supplied), _main.API_TOKEN):
        await ws.close(code=_WS_AUTH_FAIL_CODE, reason="auth rejected")
        return False
    return True


@router.websocket("/ws/status")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    if not await _require_auth_frame(ws):
        return
    _connections.append(ws)
    logger.info("WebSocket client connected (%d total)", len(_connections))

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
                inp = JoystickInput(
                    direction=data.get("direction", 0),
                    intensity=data.get("intensity", 0),
                )
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
        if ws in _connections:
            _connections.remove(ws)
        logger.info("WebSocket client disconnected (%d remaining)", len(_connections))
