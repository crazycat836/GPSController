"""Shared HTTP error helpers for API routers.

Centralises the `{code, message}` detail envelope used across every API so
internal exception text never leaks onto the wire. Raise the result of
``http_err(...)`` instead of ``HTTPException(detail=str(e))``.
"""

from fastapi import HTTPException

from config import MAX_DEVICES
from core.device_manager import UnsupportedIosVersionError


def http_err(status: int, code: str, message: str) -> HTTPException:
    """Build a structured HTTPException with `{code, message}` detail.

    Use this instead of raising `HTTPException(detail=str(e))` so internal
    exception text never leaks to API clients.
    """
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def max_devices_error() -> HTTPException:
    """409 raised when the connected-device cap is exceeded.

    Used by every connect-style endpoint (USB connect, WiFi-tunnel
    connect, discover-then-connect) so the frontend keys i18n on a single
    code for all three.
    """
    return HTTPException(
        status_code=409,
        detail={
            "code": "max_devices_reached",
            "message": f"Maximum {MAX_DEVICES} devices connected",
        },
    )


def ios_unsupported_error(version: str) -> HTTPException:
    """400 raised when a connect attempt sees an iOS version the engine
    can't drive (currently <17.0). The detail carries the observed
    version + minimum supported version so the frontend can render a
    targeted upgrade prompt instead of a generic failure toast.
    """
    return HTTPException(
        status_code=400,
        detail={
            "code": "ios_unsupported",
            "message": (
                f"Detected iOS {version}; GPSController v0.1.49+ requires "
                f"iOS {UnsupportedIosVersionError.MIN_VERSION} or newer. "
                f"Please update to iOS {UnsupportedIosVersionError.MIN_VERSION}+ before connecting."
            ),
            "ios_version": version,
            "min_version": UnsupportedIosVersionError.MIN_VERSION,
        },
    )
