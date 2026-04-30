from pathlib import Path
from typing import TypedDict

from version import __version__

# Paths
DATA_DIR = Path.home() / ".gpscontroller"
DATA_DIR.mkdir(exist_ok=True)
SETTINGS_FILE = DATA_DIR / "settings.json"
BOOKMARKS_FILE = DATA_DIR / "bookmarks.json"
ROUTES_FILE = DATA_DIR / "routes.json"
# Session-scoped token used by the renderer to authenticate every REST
# and WebSocket call. Regenerated on each backend startup and written
# with mode 0600 so only the current user can read it.
TOKEN_FILE = DATA_DIR / "token"

# OSRM
OSRM_BASE_URL = "https://router.project-osrm.org"

# Nominatim
NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
NOMINATIM_USER_AGENT = f"GPSController/{__version__}"


class SpeedProfile(TypedDict):
    """Runtime speed profile consumed by the simulation engine."""
    speed_mps: float        # metres per second
    jitter: float           # ± jitter added to each tick for realism (metres)
    update_interval: float  # tick period (seconds)


# Speed profiles (m/s). km/h equivalents: walking 10.8, running 19.8,
# driving 60. Must match the frontend `SPEED_MAP` / `SPEED_PRESETS`.
SPEED_PROFILES: dict[str, SpeedProfile] = {
    "walking": {"speed_mps": 3.0,    "jitter": 0.3, "update_interval": 1.0},
    "running": {"speed_mps": 5.5,    "jitter": 0.5, "update_interval": 1.0},
    "driving": {"speed_mps": 16.667, "jitter": 1.0, "update_interval": 0.5},
}


def make_speed_profile(speed_kmh: float) -> SpeedProfile:
    """Build a speed profile dict from a km/h value."""
    speed_mps = speed_kmh / 3.6
    jitter = min(speed_mps * 0.2, 1.5)
    update_interval = 0.5 if speed_mps > 5 else 1.0
    return {"speed_mps": speed_mps, "jitter": jitter, "update_interval": update_interval}


def resolve_speed_profile(
    profile_name: str,
    speed_kmh: float | None = None,
    speed_min_kmh: float | None = None,
    speed_max_kmh: float | None = None,
) -> SpeedProfile:
    """Return a speed profile, picking a random km/h from the range if provided.
    Precedence: range > fixed custom > mode default."""
    import random
    if speed_min_kmh is not None and speed_max_kmh is not None:
        lo, hi = sorted((float(speed_min_kmh), float(speed_max_kmh)))
        if lo <= 0:
            lo = 0.1
        return make_speed_profile(random.uniform(lo, hi))
    if speed_kmh:
        return make_speed_profile(speed_kmh)
    return SPEED_PROFILES[profile_name]


# Cooldown table: (max_distance_km, cooldown_seconds)
COOLDOWN_TABLE = [
    (1, 0),
    (5, 30),
    (10, 120),
    (25, 300),
    (100, 900),
    (250, 1500),
    (500, 2700),
    (750, 3600),
    (1000, 5400),
    (float("inf"), 7200),
]

# Pause defaults (used across all movement modes)
DEFAULT_PAUSE_ENABLED = True
DEFAULT_PAUSE_MIN = 5.0
DEFAULT_PAUSE_MAX = 20.0

# Reconnect
RECONNECT_BASE_DELAY = 2.0
RECONNECT_MAX_DELAY = 60.0
RECONNECT_MAX_RETRIES = 30

# Default location (Taipei City Hall)
DEFAULT_LOCATION = {"lat": 25.0375, "lng": 121.5637}

# Server
# Bind to loopback only — this is a local desktop app. Exposing the API on
# 0.0.0.0 lets any LAN peer drive the simulator without authentication.
API_HOST = "127.0.0.1"
API_PORT = 8777

# Group / dual-device cap. Auto-connect, manual /devices/connect, and the
# usbmux watchdog all enforce this ceiling so the simulation engine pool
# never exceeds the supported size.
MAX_DEVICES = 2
