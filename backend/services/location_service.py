"""
GPSController Location Service

Provides a unified interface for iOS location simulation across different
iOS versions, wrapping pymobiledevice3's location simulation capabilities.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from enum import StrEnum

import asyncio

from pymobiledevice3.exceptions import (
    ConnectionFailedToUsbmuxdError,
    ConnectionTerminatedError,
    DeveloperDiskImageNotFoundError,
    DeveloperModeIsNotEnabledError,
    MuxException,
    PasscodeRequiredError,
    PasswordRequiredError,
    RSDRequiredError,
    TunneldConnectionError,
)
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
from pymobiledevice3.services.simulate_location import DtSimulateLocation

from config import DVT_RECONNECT_DELAYS

logger = logging.getLogger(__name__)


class DeviceLostCause(StrEnum):
    """Why a DeviceLostError was raised. The frontend uses this to show a
    cause-specific message instead of the generic 'device lost'. Lower-cased
    snake_case values are used directly as JSON wire format."""

    UNKNOWN = "unknown"
    USB_REMOVED = "usb_removed"
    WIFI_DROPPED = "wifi_dropped"
    PHONE_LOCKED = "phone_locked"
    DDI_NOT_MOUNTED = "ddi_not_mounted"


class DeviceLostError(RuntimeError):
    """Raised when a location service determines the underlying device
    connection is no longer recoverable. The ``cause`` attribute identifies
    the root-cause class so the API layer can surface a precise user-facing
    message; ``UNKNOWN`` is the safe default when classification fails.
    """

    def __init__(
        self,
        message: str = "",
        *,
        cause: DeviceLostCause = DeviceLostCause.UNKNOWN,
    ) -> None:
        super().__init__(message)
        self.cause: DeviceLostCause = cause


def classify_device_lost_cause(exc: BaseException | None) -> DeviceLostCause:
    """Walk *exc* (and its ``__cause__`` chain) and pick the matching
    DeviceLostCause based on pymobiledevice3 exception types. Returns
    ``UNKNOWN`` when no specific class can be identified.
    """
    visited: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        if isinstance(current, (PasswordRequiredError, PasscodeRequiredError)):
            return DeviceLostCause.PHONE_LOCKED
        if isinstance(current, (DeveloperDiskImageNotFoundError, DeveloperModeIsNotEnabledError)):
            return DeviceLostCause.DDI_NOT_MOUNTED
        if isinstance(current, (RSDRequiredError, TunneldConnectionError)):
            return DeviceLostCause.WIFI_DROPPED
        if isinstance(current, (ConnectionFailedToUsbmuxdError, MuxException)):
            return DeviceLostCause.USB_REMOVED
        current = current.__cause__
    return DeviceLostCause.UNKNOWN


def _raise_device_lost(message: str, exc: BaseException) -> None:
    """Classify *exc*, log at error level with the cause label, and raise
    ``DeviceLostError`` chained from it. Pulls the three reconnect-exhausted
    raise sites onto a single audit-friendly path."""
    cause = classify_device_lost_cause(exc)
    logger.error("%s — device likely lost (%s, cause=%s)", message, exc, cause.value)
    raise DeviceLostError(f"{message}: {exc}", cause=cause) from exc


def unwrap_device_lost(exc: BaseException | None) -> DeviceLostError | None:
    """Walk an exception's ``__cause__`` chain looking for a DeviceLostError.

    DeviceLostError is often re-raised wrapped (e.g. from pymobiledevice3
    timeouts or the simulation engine retry loop). Callers use this to detect
    a lost device after catching a generic Exception so they can run the
    standard cleanup + ``device_disconnected`` broadcast flow instead of
    treating it as a generic 500.
    """
    cause: BaseException | None = exc
    while cause is not None:
        if isinstance(cause, DeviceLostError):
            return cause
        cause = cause.__cause__
    return None


class LocationService(ABC):
    """
    Abstract base for location simulation services.

    Subclasses implement version-specific simulation using either the DVT
    instrumentation channel (iOS 17+) or the legacy DtSimulateLocation
    service (iOS < 17).
    """

    @abstractmethod
    async def set(self, lat: float, lng: float) -> None:
        """Simulate the device location to the given coordinates."""

    @abstractmethod
    async def clear(self) -> None:
        """Stop simulating and restore the real device location."""

    @property
    def active_state(self) -> bool:
        """Whether the service is currently pushing a simulated location.

        Public, read-only view of the internal ``_active`` flag —
        ``/api/location/debug`` surfaces this instead of reaching into
        the private attribute. Subclasses keep their existing
        ``_active`` bookkeeping; the default implementation returns
        ``getattr(self, "_active", False)`` so future implementations
        without that attribute degrade gracefully.
        """
        return bool(getattr(self, "_active", False))


class DvtLocationService(LocationService):
    """
    Location simulation for iOS 17+ devices via the DVT LocationSimulation
    instrument.

    Holds a reference to the underlying lockdown/RSD service so it can
    fully recreate the DvtProvider when the channel drops (e.g. screen
    lock over WiFi).

    Parameters
    ----------
    dvt_provider
        An active DvtProvider session connected to the target device.
    lockdown
        The lockdown or RSD service used to create the DvtProvider.
        Needed for reconnection.
    """

    def __init__(self, dvt_provider: DvtProvider, lockdown=None) -> None:
        self._dvt = dvt_provider
        self._lockdown = lockdown
        self._location_sim: LocationSimulation | None = None
        self._active = False
        self._reconnect_lock = asyncio.Lock()

    async def _ensure_instrument(self) -> LocationSimulation:
        """Lazily create, connect, and cache the LocationSimulation instrument."""
        if self._location_sim is None:
            self._location_sim = LocationSimulation(self._dvt)
            await self._location_sim.connect()
            logger.debug("DVT LocationSimulation instrument initialised and connected")
        return self._location_sim

    async def _reconnect(self) -> None:
        """Tear down and fully recreate the DVT provider and instrument.

        Retries with a graded backoff totalling ~15s. The early attempts
        (0.5s, 2s elapsed) catch the common 1-2s blip fast; the later
        attempts (5s, 9s, 15s elapsed) cover screen-lock and WiFi-roam
        pauses that pymobiledevice3 can take several seconds to walk back
        from. 15s also matches the tunnel liveness probe window, so a
        truly-dead tunnel is broadcast as device_disconnected at roughly
        the same moment this gives up — the UI is never stuck in a
        "reconnecting" state past the point we've already declared the
        device gone.

        Emits ``tunnel_degraded`` once we commit to the reconnect (after
        the lock) so the renderer can show a "reconnecting…" hint
        instead of leaving the device pill confidently green for 15s.
        ``tunnel_recovered`` fires on any successful recreate; final
        failure falls through to ``_raise_device_lost`` whose
        ``device_disconnected`` broadcast supersedes the degraded state.
        """
        # Local import: ``ws_broadcaster`` itself imports nothing from
        # this module, but several ``core/`` modules pull
        # ``location_service`` in at load time. Keeping the broadcaster
        # import lazy sidesteps any future re-ordering hazard.
        from services.ws_broadcaster import broadcast

        async with self._reconnect_lock:
            await broadcast("tunnel_degraded", {"reason": "dvt_channel_dropped"})

            # Close the old DVT provider gracefully
            try:
                await self._dvt.__aexit__(None, None, None)
            except Exception:
                logger.debug("Ignoring error while closing old DvtProvider")

            self._location_sim = None

            if self._lockdown is None:
                raise RuntimeError("Cannot reconnect DVT: no lockdown/RSD reference")

            # Schedule lives in config.DVT_RECONNECT_DELAYS so the rationale
            # (cumulative ≈15s, tight-then-stretched) sits next to the rest
            # of the project's tunables instead of being buried mid-method.
            last_exc: Exception | None = None
            for attempt, delay in enumerate(DVT_RECONNECT_DELAYS, start=1):
                try:
                    new_dvt = DvtProvider(self._lockdown)
                    await new_dvt.__aenter__()
                    self._dvt = new_dvt
                    logger.info("DVT provider reconnected on attempt %d", attempt)
                    await broadcast("tunnel_recovered", {})
                    return
                except Exception as exc:
                    last_exc = exc
                    logger.warning(
                        "DVT reconnect attempt %d/%d failed (%s); retrying in %.1fs",
                        attempt, len(DVT_RECONNECT_DELAYS), type(exc).__name__, delay,
                    )
                    await asyncio.sleep(delay)
            # Final try without delay
            try:
                new_dvt = DvtProvider(self._lockdown)
                await new_dvt.__aenter__()
                self._dvt = new_dvt
                logger.info("DVT provider reconnected on final attempt")
                await broadcast("tunnel_recovered", {})
                return
            except Exception as exc:
                last_exc = exc
            assert last_exc is not None  # delays loop ran at least once
            _raise_device_lost("DVT reconnect failed", last_exc)

    async def set(self, lat: float, lng: float) -> None:
        """Simulate the device location using the DVT instrument channel."""
        try:
            sim = await self._ensure_instrument()
            await sim.set(lat, lng)
            self._active = True
            logger.info("DVT location set to (%.6f, %.6f)", lat, lng)
        except (ConnectionTerminatedError, OSError, EOFError, BrokenPipeError,
                ConnectionResetError, asyncio.TimeoutError) as exc:
            logger.warning("DVT channel dropped (%s: %s); reconnecting and retrying",
                           type(exc).__name__, exc)
            await self._reconnect()
            sim = await self._ensure_instrument()
            await sim.set(lat, lng)
            self._active = True
            logger.info("DVT location set to (%.6f, %.6f) after reconnect", lat, lng)
        except Exception:
            logger.exception("Failed to set DVT simulated location")
            raise

    async def clear(self) -> None:
        """Clear the simulated location via the DVT instrument channel.

        Always sends clear to the device even when _active is False —
        the device may hold a stale simulated location from a prior
        session or backend restart.
        """
        try:
            sim = await self._ensure_instrument()
            await sim.clear()
            self._active = False
            logger.info("DVT simulated location cleared")
        except (ConnectionTerminatedError, OSError, EOFError, BrokenPipeError,
                ConnectionResetError, asyncio.TimeoutError) as exc:
            logger.warning("DVT channel dropped during clear (%s: %s); reconnecting",
                           type(exc).__name__, exc)
            await self._reconnect()
            sim = await self._ensure_instrument()
            await sim.clear()
            self._active = False
            logger.info("DVT simulated location cleared after reconnect")
        except Exception:
            logger.exception("Failed to clear DVT simulated location")
            raise


class LegacyLocationService(LocationService):
    """
    Location simulation for iOS < 17 devices via DtSimulateLocation.

    Parameters
    ----------
    lockdown_client
        A lockdown service provider (LockdownClient) for the target device.
    """

    def __init__(self, lockdown_client) -> None:
        self._lockdown = lockdown_client
        self._service: DtSimulateLocation | None = None
        self._active = False

    def _ensure_service(self) -> DtSimulateLocation:
        """Lazily create and cache the DtSimulateLocation service."""
        if self._service is None:
            self._service = DtSimulateLocation(self._lockdown)
            logger.debug("Legacy DtSimulateLocation service initialised")
        return self._service

    async def _maybe_await(self, result) -> None:
        """Support both sync and async DtSimulateLocation methods."""
        if asyncio.iscoroutine(result):
            await result

    def _reset_service(self) -> None:
        """Drop the cached DtSimulateLocation so the next call reconstructs it."""
        try:
            if self._service is not None and hasattr(self._service, "close"):
                self._service.close()
        except Exception:
            logger.debug("Error closing stale DtSimulateLocation", exc_info=True)
        self._service = None

    async def set(self, lat: float, lng: float) -> None:
        """Simulate the device location using the legacy service."""
        try:
            svc = self._ensure_service()
            await self._maybe_await(svc.set(lat, lng))
            self._active = True
            logger.info("Legacy location set to (%.6f, %.6f)", lat, lng)
        except (OSError, EOFError, BrokenPipeError, ConnectionResetError) as exc:
            logger.warning("Legacy location channel dropped (%s: %s); reconnecting and retrying",
                           type(exc).__name__, exc)
            self._reset_service()
            try:
                svc = self._ensure_service()
                await self._maybe_await(svc.set(lat, lng))
                self._active = True
                logger.info("Legacy location set to (%.6f, %.6f) after reconnect", lat, lng)
            except Exception as retry_exc:
                _raise_device_lost("Legacy reconnect failed", retry_exc)
        except Exception:
            logger.exception("Failed to set legacy simulated location")
            raise

    async def clear(self) -> None:
        """Clear the simulated location using the legacy service.

        Always sends clear to the device even when _active is False —
        the device may hold a stale simulated location from a prior
        session or backend restart.

        Raises DeviceLostError on retry-after-reconnect failure, matching
        the discipline in set(). Without this, a clear() on a dead device
        would silently log + return, leaving the engine task convinced
        the simulation was cleanly torn down.
        """
        try:
            svc = self._ensure_service()
            await self._maybe_await(svc.clear())
            self._active = False
            logger.info("Legacy simulated location cleared")
        except (OSError, EOFError, BrokenPipeError, ConnectionResetError) as exc:
            logger.warning("Legacy clear channel dropped (%s: %s); reconnecting",
                           type(exc).__name__, exc)
            self._reset_service()
            try:
                svc = self._ensure_service()
                await self._maybe_await(svc.clear())
                self._active = False
            except Exception as retry_exc:
                _raise_device_lost("Legacy clear failed after reconnect", retry_exc)
        except Exception:
            logger.exception("Failed to clear legacy simulated location")
            raise
