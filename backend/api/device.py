from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models.schemas import DeviceInfo

router = APIRouter(prefix="/api/device", tags=["device"])


def _dm():
    from main import app_state
    return app_state.device_manager


@router.get("/list", response_model=list[DeviceInfo])
async def list_devices():
    dm = _dm()
    return await dm.discover_devices()


@router.post("/{udid}/connect")
async def connect_device(udid: str):
    from main import app_state
    dm = _dm()
    try:
        await dm.connect(udid)
        await app_state.create_engine_for_device(udid)
        return {"status": "connected", "udid": udid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{udid}/connect")
async def disconnect_device(udid: str):
    dm = _dm()
    await dm.disconnect(udid)
    return {"status": "disconnected", "udid": udid}


@router.get("/{udid}/info", response_model=DeviceInfo | None)
async def device_info(udid: str):
    dm = _dm()
    devices = await dm.discover_devices()
    for d in devices:
        if d.udid == udid:
            return d
    raise HTTPException(status_code=404, detail="Device not found")


# ── WiFi connection ─────────────────────────────────────

class WifiConnectRequest(BaseModel):
    ip: str


@router.post("/wifi/connect")
async def wifi_connect(req: WifiConnectRequest):
    """Connect to an iOS device over WiFi by IP address."""
    from main import app_state
    dm = _dm()
    try:
        info = await dm.connect_wifi(req.ip)
        await app_state.create_engine_for_device(info.udid)
        return {
            "status": "connected",
            "udid": info.udid,
            "name": info.name,
            "ios_version": info.ios_version,
            "connection_type": "Network",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/wifi/scan")
async def wifi_scan():
    """Scan the local network for iOS devices."""
    dm = _dm()
    try:
        results = await dm.scan_wifi_devices()
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class WifiTunnelConnectRequest(BaseModel):
    rsd_address: str
    rsd_port: int


@router.post("/wifi/tunnel")
async def wifi_tunnel_connect(req: WifiTunnelConnectRequest):
    """Connect to a device via an existing WiFi tunnel (RSD address/port)."""
    from main import app_state
    dm = _dm()
    try:
        info = await dm.connect_wifi_tunnel(req.rsd_address, req.rsd_port)
        await app_state.create_engine_for_device(info.udid)
        return {
            "status": "connected",
            "udid": info.udid,
            "name": info.name,
            "ios_version": info.ios_version,
            "connection_type": "Network",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── WiFi Tunnel lifecycle (start / status / stop) ───────

import asyncio
import json
import subprocess
import sys
import logging
from pathlib import Path

_tunnel_logger = logging.getLogger("wifi_tunnel")
_tunnel_proc: subprocess.Popen | None = None
_tunnel_info: dict | None = None


def _kill_stale_tunnel_processes() -> int:
    """Kill any leftover wifi_tunnel.py python processes from previous runs.
    Returns the number of processes killed."""
    killed = 0
    # wmic was removed from Windows 11 — use PowerShell CIM instead.
    ps_script = (
        "Get-CimInstance Win32_Process -Filter \"Name like 'py%.exe' or Name like 'python%.exe'\" "
        "| Where-Object { $_.CommandLine -like '*wifi_tunnel.py*' } "
        "| Select-Object -ExpandProperty ProcessId"
    )
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", ps_script],
            stderr=subprocess.DEVNULL, timeout=10, text=True,
        )
        for line in out.splitlines():
            pid = line.strip()
            if not pid.isdigit():
                continue
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", pid],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=5,
                )
                killed += 1
                _tunnel_logger.info("Killed stale tunnel process PID=%s", pid)
            except Exception:
                _tunnel_logger.exception("Failed to kill PID=%s", pid)
    except FileNotFoundError:
        _tunnel_logger.warning("PowerShell not found; skipping stale tunnel cleanup")
    except Exception:
        _tunnel_logger.exception("Failed to enumerate stale tunnel processes")
    # Remove stale info file
    try:
        info_path = Path.home() / ".locwarp" / "wifi_tunnel_info.json"
        if info_path.exists():
            info_path.unlink()
    except Exception:
        pass
    return killed


class WifiTunnelStartRequest(BaseModel):
    ip: str
    port: int = 49152
    udid: str = "00008140-001C096E02EA801C"


@router.get("/wifi/tunnel/discover")
async def wifi_tunnel_discover():
    """Browse the local network via Bonjour/mDNS for iOS devices advertising
    the RemotePairing service. Returns a list of candidate (ip, port) pairs."""
    try:
        from pymobiledevice3.bonjour import browse_remotepairing
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"bonjour module unavailable: {e}")

    try:
        instances = await browse_remotepairing(timeout=3.0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"mDNS browse failed: {e}")

    results = []
    for inst in instances:
        # Prefer IPv4 addresses for WiFi tunnel use
        ipv4s = [a for a in (inst.addresses or []) if ":" not in a]
        addrs = ipv4s if ipv4s else list(inst.addresses or [])
        for addr in addrs:
            results.append({
                "ip": addr,
                "port": inst.port,
                "host": inst.host,
                "name": inst.instance or inst.host,
            })

    # De-dupe on (ip, port)
    seen = set()
    unique = []
    for r in results:
        key = (r["ip"], r["port"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)

    return {"devices": unique}


def _find_python313() -> list[str] | None:
    """Find a Python 3.13+ interpreter on the system.  Returns the
    command as a list of strings suitable for ``subprocess.Popen``."""
    import shutil

    for name in ("py", "python3.13", "python3", "python"):
        path = shutil.which(name)
        if path is None:
            continue
        try:
            cmd = [path, "-3.13", "--version"] if name == "py" else [path, "--version"]
            out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=5)
            ver = out.decode().strip()
            parts = ver.split()[-1].split(".")
            if int(parts[0]) >= 3 and int(parts[1]) >= 13:
                return [path, "-3.13"] if name == "py" else [path]
        except Exception:
            continue
    return None


@router.post("/wifi/tunnel/start")
async def wifi_tunnel_start(req: WifiTunnelStartRequest):
    """Start a WiFi tunnel subprocess (requires Python 3.13+ and admin)."""
    global _tunnel_proc, _tunnel_info

    if _tunnel_proc is not None and _tunnel_proc.poll() is None:
        if _tunnel_info:
            return {"status": "already_running", **_tunnel_info}
        return {"status": "already_running"}

    # Clean up any orphaned tunnel processes from previous runs (crashes,
    # force-kills, etc.) — a stale TUN interface will prevent the new
    # tunnel's routes from coming up cleanly.
    stale_killed = _kill_stale_tunnel_processes()
    if stale_killed:
        _tunnel_logger.info("Cleaned up %d stale tunnel process(es)", stale_killed)
        await asyncio.sleep(1.5)  # give Windows time to tear down the TUN iface

    # Prefer the bundled wifi-tunnel.exe next to us (PyInstaller build).
    # Fall back to spawning py -3.13 wifi_tunnel.py in dev mode.
    bundled_tunnel = None
    if getattr(sys, "frozen", False):
        # Running from PyInstaller bundle: resources/backend/locwarp-backend.exe
        # Tunnel sits in resources/wifi-tunnel/wifi-tunnel.exe
        candidate = Path(sys.executable).resolve().parent.parent / "wifi-tunnel" / "wifi-tunnel.exe"
        if candidate.exists():
            bundled_tunnel = candidate

    if bundled_tunnel is not None:
        cmd_parts = [str(bundled_tunnel), "--ip", req.ip, "--port", str(req.port), "--udid", req.udid]
    else:
        py = _find_python313()
        if py is None:
            raise HTTPException(
                status_code=500,
                detail="Python 3.13+ not found. WiFi tunnel requires Python 3.13+ for TLS-PSK support.",
            )

        script = Path(__file__).resolve().parent.parent.parent / "wifi_tunnel.py"
        if not script.exists():
            raise HTTPException(status_code=500, detail=f"wifi_tunnel.py not found at {script}")

        cmd_parts = py + [str(script), "--ip", req.ip, "--port", str(req.port), "--udid", req.udid]
    _tunnel_logger.info("Starting WiFi tunnel: %s", " ".join(cmd_parts))

    try:
        _tunnel_proc = subprocess.Popen(
            cmd_parts,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start tunnel process: {e}")

    # Wait up to 20 seconds for the tunnel info file to appear
    info_path = Path.home() / ".locwarp" / "wifi_tunnel_info.json"
    for _ in range(40):
        await asyncio.sleep(0.5)
        if _tunnel_proc.poll() is not None:
            output = _tunnel_proc.stdout.read() if _tunnel_proc.stdout else ""
            _tunnel_proc = None
            raise HTTPException(
                status_code=500,
                detail=f"Tunnel process exited unexpectedly:\n{output[-500:]}",
            )
        if info_path.exists():
            try:
                data = json.loads(info_path.read_text())
                _tunnel_info = data
                _tunnel_logger.info("WiFi tunnel started: %s", data)
                return {"status": "started", **data}
            except json.JSONDecodeError:
                continue

    # Timeout
    if _tunnel_proc and _tunnel_proc.poll() is None:
        _tunnel_proc.terminate()
    _tunnel_proc = None
    raise HTTPException(status_code=500, detail="Tunnel startup timed out (20s)")


@router.get("/wifi/tunnel/status")
async def wifi_tunnel_status():
    """Check if the WiFi tunnel subprocess is running."""
    global _tunnel_proc, _tunnel_info

    if _tunnel_proc is None or _tunnel_proc.poll() is not None:
        _tunnel_proc = None
        _tunnel_info = None
        return {"running": False}

    return {"running": True, **(_tunnel_info or {})}


@router.post("/wifi/tunnel/stop")
async def wifi_tunnel_stop():
    """Stop the WiFi tunnel subprocess."""
    global _tunnel_proc, _tunnel_info

    if _tunnel_proc is None or _tunnel_proc.poll() is not None:
        _tunnel_proc = None
        _tunnel_info = None
        return {"status": "not_running"}

    _tunnel_proc.terminate()
    try:
        _tunnel_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _tunnel_proc.kill()

    _tunnel_proc = None
    _tunnel_info = None

    info_path = Path.home() / ".locwarp" / "wifi_tunnel_info.json"
    if info_path.exists():
        info_path.unlink()

    return {"status": "stopped"}


@router.post("/wifi/tunnel/start-and-connect")
async def wifi_tunnel_start_and_connect(req: WifiTunnelStartRequest):
    """Start a WiFi tunnel and immediately connect the device through it."""
    from main import app_state

    # Start the tunnel
    tunnel_result = await wifi_tunnel_start(req)
    if tunnel_result.get("status") not in ("started", "already_running"):
        raise HTTPException(status_code=500, detail="Tunnel failed to start")

    rsd_address = tunnel_result.get("rsd_address")
    rsd_port = tunnel_result.get("rsd_port")

    if not rsd_address or not rsd_port:
        raise HTTPException(status_code=500, detail="Tunnel started but no RSD info available")

    # Connect through the tunnel
    dm = _dm()
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tunnel started but connection failed: {e}")
