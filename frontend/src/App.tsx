import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type L from 'leaflet'
import { useT } from './i18n'
import type { StringKey } from './i18n/strings'
import { SimMode, type LatLng } from './hooks/useSimulation'
import type { DeviceLostCause } from './hooks/useDevice'
import { STORAGE_KEYS } from './lib/storage-keys'
import { haversineM, polylineDistanceM } from './lib/geo'

// Context providers
import { ToastProvider, useToastContext } from './contexts/ToastContext'
import { WebSocketProvider } from './contexts/WebSocketContext'
import { DeviceProvider, useDeviceContext } from './contexts/DeviceContext'
import { ConnectionHealthProvider } from './contexts/ConnectionHealthContext'
import { SimProvider, useSimContext, SPEED_MAP } from './contexts/SimContext'
import { SimSettingsProvider, useSimSettings } from './contexts/SimSettingsContext'
import { SimDerivedProvider, useSimDerived } from './contexts/SimDerivedContext'
import { BookmarkProvider, useBookmarkContext } from './contexts/BookmarkContext'
import { AvatarProvider } from './contexts/AvatarContext'

// Components
import MapView from './components/MapView'
import EtaBar from './components/EtaBar'
import UpdateChecker from './components/UpdateChecker'
// Shell components
import TopBar from './components/shell/TopBar'
import Brand from './components/shell/Brand'
import SearchBar from './components/shell/SearchBar'
import BottomModeBar, { isRouteSubMode } from './components/shell/BottomModeBar'
import BottomDock from './components/shell/BottomDock'
import MiniStatusBar from './components/shell/MiniStatusBar'
import TopBarActions from './components/shell/TopBarActions'
import SettingsMenu from './components/shell/SettingsMenu'
import CooldownBadge from './components/shell/CooldownBadge'
import ConnectionStatusBanner from './components/shell/ConnectionStatusBanner'
import Toast from './components/shell/Toast'

// Contexts consumed inside AppShell
import { useConnectionHealth } from './contexts/ConnectionHealthContext'


// Modals/Drawers
import DevicesPopover from './components/device/DevicesPopover'
import LibraryDrawer from './components/modals/LibraryDrawer'
import BookmarkEditDialog, { type BookmarkEditValues } from './components/library/BookmarkEditDialog'
import SaveRouteDialog from './components/library/SaveRouteDialog'

// Root component — just providers.
//
// Order matters: WebSocketProvider is the single owner of the backend
// socket; everything else reads from it. DeviceProvider feeds state
// into ConnectionHealthProvider, which then fans `canOperate` /
// `hint` out to action-button consumers (panels, search bar, banner).
// SimProvider sits inside health so sim consumers can disable actions
// without duplicating the health derivation.

// i18n keys for cause-classified device-lost toasts. `unknown` (and any
// future cause we don't have a key for yet) falls back to the generic
// `toast.device_lost`. Mirrors the SIM_ERROR_KEYS pattern in SimContext.
const DEVICE_LOST_TOAST_KEYS: Record<DeviceLostCause, StringKey> = {
  unknown: 'toast.device_lost',
  usb_removed: 'toast.device_lost.usb_removed',
  wifi_dropped: 'toast.device_lost.wifi_dropped',
  phone_locked: 'toast.device_lost.phone_locked',
  ddi_not_mounted: 'toast.device_lost.ddi_not_mounted',
}

function App() {
  return (
    <ToastProvider>
      <WebSocketProvider>
        <DeviceProvider>
          <ConnectionHealthProvider>
            <SimSettingsProvider>
              <SimProvider>
                <SimDerivedProvider>
                  <BookmarkProvider>
                    <AvatarProvider>
                      <AppShell />
                    </AvatarProvider>
                  </BookmarkProvider>
                </SimDerivedProvider>
              </SimProvider>
            </SimSettingsProvider>
          </ConnectionHealthProvider>
        </DeviceProvider>
      </WebSocketProvider>
    </ToastProvider>
  )
}

// Auto-dismissing error banner (5s timeout, click to dismiss immediately)
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  return createPortal(
    <div
      className="toast-pill toast-pill-danger top-3"
      onClick={onDismiss}
      role="alert"
      style={{ cursor: 'pointer' }}
    >
      <span>{message}</span>
      <span style={{ opacity: 0.7, fontSize: 11, flexShrink: 0 }} aria-hidden>✕</span>
    </div>,
    document.body,
  )
}

// Resolve the effective km/h used for preview ETA. Matches the precedence
// the backend applies: custom speed > random range midpoint > mode preset.
function resolveSpeedKmh(
  customKmh: number | null,
  minKmh: number | null,
  maxKmh: number | null,
  moveMode: string,
): number {
  if (customKmh != null) return customKmh
  if (minKmh != null && maxKmh != null) return (minKmh + maxKmh) / 2
  return SPEED_MAP[moveMode as keyof typeof SPEED_MAP] ?? 5
}

// Inner shell — consumes all contexts
function AppShell() {
  const t = useT()
  const toast = useToastContext()
  const device = useDeviceContext()
  const simCtx = useSimContext()
  const { currentPos: simCurrentPos, destPos: simDestPos } = useSimDerived()
  const simSettings = useSimSettings()
  const bm = useBookmarkContext()
  const health = useConnectionHealth()
  const { sim, handlePause, handleResume } = simCtx

  // Track the last-used Route sub-mode so switching back to "Route"
  // resumes the same sub-tab (Loop / Multi-Stop / Random).
  const [lastRouteSubMode, setLastRouteSubMode] = useState(SimMode.Loop)
  useEffect(() => {
    if (isRouteSubMode(sim.mode)) setLastRouteSubMode(sim.mode)
  }, [sim.mode])

  const mapWaypoints = useMemo(
    () => sim.waypoints.map((w: LatLng, i: number) => ({ ...w, index: i })),
    [sim.waypoints],
  )

  // Static preview for the ETA bar before simulation starts.
  // Only makes sense for routed modes (Navigate / Loop / MultiStop).
  const plannedDistanceM = useMemo(() => {
    const { mode, waypoints } = sim
    if (mode === SimMode.Navigate) {
      return simCurrentPos && simDestPos
        ? haversineM(simCurrentPos, simDestPos)
        : 0
    }
    if (mode === SimMode.Loop) {
      if (waypoints.length < 2) return 0
      return polylineDistanceM(waypoints) + haversineM(waypoints[waypoints.length - 1], waypoints[0])
    }
    if (mode === SimMode.MultiStop) {
      return waypoints.length < 2 ? 0 : polylineDistanceM(waypoints)
    }
    return 0
  }, [sim.mode, sim.waypoints, simCurrentPos, simDestPos])

  const plannedEtaSeconds = useMemo(() => {
    if (plannedDistanceM <= 0) return 0
    const kmh = resolveSpeedKmh(sim.customSpeedKmh, sim.speedMinKmh, sim.speedMaxKmh, sim.moveMode)
    const ms = kmh * 1000 / 3600
    return ms > 0 ? plannedDistanceM / ms : 0
  }, [plannedDistanceM, sim.customSpeedKmh, sim.speedMinKmh, sim.speedMaxKmh, sim.moveMode])

  // Search box: in Teleport mode it stages a pending destination (the
  // panel then shows a Go button) instead of teleporting immediately.
  // Other modes keep instant teleport.
  const handleTeleportOrStage = useCallback((lat: number, lng: number) => {
    if (sim.mode === SimMode.Teleport) {
      simCtx.handleSetTeleportDest(lat, lng)
    } else {
      simCtx.handleTeleport(lat, lng)
    }
  }, [sim.mode, simCtx])

  // Map right-click "Teleport here" always teleports immediately, in every
  // mode (including Teleport) — the context-menu action is an explicit
  // "go there now" gesture, so it never stages a pending pin.
  const handleTeleportNow = useCallback((lat: number, lng: number) => {
    simCtx.handleTeleport(lat, lng)
  }, [simCtx])

  // UI state
  const [devicesPopoverAnchor, setDevicesPopoverAnchor] = useState<DOMRect | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saveRouteOpen, setSaveRouteOpen] = useState(false)

  // Leaflet instance is owned by MapView; we hold a ref here so features
  // like "Locate PC" can pan the camera without teleporting.
  const mapRef = useRef<L.Map | null>(null)
  const handleMapReady = useCallback((map: L.Map | null) => {
    mapRef.current = map
  }, [])
  const handleFlyToCoordinate = useCallback((lat: number, lng: number, zoom?: number) => {
    const map = mapRef.current
    if (!map) return
    map.setView([lat, lng], zoom ?? map.getZoom(), { animate: true })
  }, [])
  // Physical PC coordinate pin — surfaced on the map after the user fires
  // a fly/teleport action from LocatePcButton; cleared on Refresh.
  const [pcMarkerCoord, setPcMarkerCoord] = useState<{ lat: number; lng: number } | null>(null)
  const [layerKey, setLayerKey] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.tileLayer) || 'osm' } catch { return 'osm' }
  })
  const handleLayerChange = useCallback((key: string) => {
    setLayerKey(key)
    try { localStorage.setItem(STORAGE_KEYS.tileLayer, key) } catch {}
  }, [])

  // No auto-scan on WebSocket connect. The backend's _send_initial_state
  // pushes a ``device_snapshot`` frame on every WS (re)connect built from
  // ``connection_state.store`` — that's the SSoT. A REST follow-up here
  // used to clobber it: a WiFi-tunnel device is in the store but invisible
  // to usbmux, so /api/device/list could briefly return ``[]`` and the
  // post-await ``setDevices(list)`` would wipe the snapshot-derived state.
  // The 30s background poll + visibility-change scan in ``useDevice`` still
  // act as a safety net for missed WS events; that path is now also safe
  // because /api/device/list merges store entries (see backend
  // ``api/device.py:list_devices``).

  // Fires one cause-specific toast per involuntary disconnect.
  const prevLastDisconnectTs = useRef(0)
  useEffect(() => {
    const ld = device.lastDisconnect
    if (!ld) return
    if (ld.ts <= prevLastDisconnectTs.current) return
    prevLastDisconnectTs.current = ld.ts
    const key = DEVICE_LOST_TOAST_KEYS[ld.cause] ?? 'toast.device_lost'
    toast.showToast(t(key), 4000)
  }, [device.lastDisconnect, toast, t])

  // Fires one toast per backend-side device setup failure (device_error WS
  // event). Without this the failure is silently dropped — the user keeps
  // trying to drive a device whose engine never came up.
  const prevLastDeviceErrorTs = useRef(0)
  useEffect(() => {
    const le = device.lastDeviceError
    if (!le) return
    if (le.ts <= prevLastDeviceErrorTs.current) return
    prevLastDeviceErrorTs.current = le.ts
    toast.showToast(t('toast.device_error'), 4000)
  }, [device.lastDeviceError, toast, t])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
      if (e.metaKey && e.key === 'b') {
        e.preventDefault(); setLibraryOpen(true); return
      }
      if (e.key === 'Escape') {
        if (libraryOpen) { setLibraryOpen(false); return }
        return
      }
      if (!isInput && e.key >= '1' && e.key <= '4') {
        const modeForKey: SimMode[] = [SimMode.Teleport, SimMode.Navigate, lastRouteSubMode, SimMode.Joystick]
        sim.setMode(modeForKey[parseInt(e.key) - 1])
        return
      }
      if (!isInput && e.key === ' ' && sim.status.running) {
        e.preventDefault()
        if (sim.status.paused) handleResume()
        else handlePause()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [libraryOpen, sim, handlePause, handleResume, lastRouteSubMode])

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <a
        href="#map-canvas"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[var(--z-toast)] focus:bg-[var(--color-accent)] focus:text-white focus:rounded-md focus:no-underline focus:font-semibold focus:px-3 focus:py-1.5"
      >
        Skip to map
      </a>
      <div data-fc="overlay.noise" className="noise-overlay" aria-hidden />

      {/* Full-screen map layer */}
      <div id="map-canvas" className="absolute inset-0">

        {/* DDI mounting overlay */}
        {sim.ddiMounting && (
          <div className="absolute inset-0 z-[var(--z-overlay)] bg-[rgba(20,22,32,0.85)] backdrop-blur-[3px] flex items-center justify-center">
            <div className="surface-popup rounded-2xl px-7 py-5 max-w-[420px] text-center">
              <svg
                width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="#a78bfa" strokeWidth="2"
                className="animate-spin mx-auto mb-2.5"
              >
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="16" />
              </svg>
              <div className="text-sm font-semibold mb-1.5 text-[var(--color-text-1)]">
                {t('ddi.mounting_title')}
              </div>
              <div className="text-xs text-[var(--color-text-2)] leading-relaxed">
                {t('ddi.mounting_hint')}
              </div>
            </div>
          </div>
        )}

        {/* Pause countdown */}
        <Toast
          visible={sim.pauseRemaining != null && sim.pauseRemaining > 0}
          variant="warning"
          top="top-28"
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          }
        >
          {t('toast.pause_countdown', { n: Math.round(sim.pauseRemaining ?? 0) })}
        </Toast>

        <MapView
          currentPosition={simCurrentPos}
          currentPositionUnsynced={!!simCurrentPos && !sim.backendPositionSynced}
          destination={simDestPos}
          waypoints={mapWaypoints}
          routePath={sim.routePath}
          randomWalkRadius={
            sim.mode === SimMode.RandomWalk ? simSettings.randomWalkRadius :
            (sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop) ? simSettings.wpGenRadius :
            null
          }
          onMapClick={simCtx.handleMapClick}
          onTeleport={handleTeleportNow}
          onNavigate={simCtx.handleNavigate}
          onAddBookmark={bm.handleAddBookmark}
          onAddWaypoint={simCtx.handleAddWaypoint}
          showWaypointOption={sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop || sim.mode === SimMode.Navigate}
          onSaveRoute={() => setSaveRouteOpen(true)}
          showSaveRouteOption={sim.waypoints.length > 0}
          deviceConnected={device.connectedDevice !== null}
          onShowToast={toast.showToast}
          layerKey={layerKey}
          onMapReady={handleMapReady}
          pcPosition={pcMarkerCoord}
        />

        {/* Add bookmark dialog (full form with place, tags, note) */}
        <BookmarkEditDialog
          open={!!bm.addBmDialog}
          mode="create"
          initialCoordinates={bm.addBmDialog ?? undefined}
          currentPosition={simCurrentPos}
          places={bm.places}
          tags={bm.tags}
          onClose={() => bm.setAddBmDialog(null)}
          onSubmit={async (values: BookmarkEditValues) => {
            bm.setAddBmDialog(null)
            try {
              await bm.createBookmark({
                name: values.name,
                lat: values.lat,
                lng: values.lng,
                place_id: values.placeId,
                tags: values.tagIds,
                note: values.note,
              })
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : ''
              toast.showToast(t('toast.save_failed', { msg: message }))
            }
          }}
        />

        {sim.error && (
          <ErrorBanner message={sim.error} onDismiss={sim.clearError} />
        )}

        {/* The bottom-left device chip was removed in the design-handoff
            phase 3: device info lives in the top-right status pair
            (MiniStatusBar) and the DeviceDrawer trigger lives in the
            TopBar's right action cluster. */}

        <EtaBar
          runtimes={sim.runtimes}
          state={sim.status?.state ?? 'idle'}
          progress={sim.progress}
          remainingDistance={sim.status?.distance_remaining ?? 0}
          traveledDistance={sim.status?.distance_traveled ?? 0}
          eta={sim.eta ?? 0}
          plannedDistanceM={plannedDistanceM}
          plannedEtaSeconds={plannedEtaSeconds}
        />
        <CooldownBadge />
        <UpdateChecker />

        {/* Anchored under the top-bar search pill (top-3 + 44px + 12px gap ≈ top-16). */}
        <Toast key={toast.toastMsg ?? ''} visible={!!toast.toastMsg} top="top-16">
          {toast.toastMsg}
        </Toast>
      </div>

      {/* Floating overlay components — siblings of the map container so
          they read as shell chrome, not map content. */}
      <MiniStatusBar />

      <ConnectionStatusBanner />

      <TopBar
        leftContent={<Brand />}
        centerContent={
          <SearchBar onTeleport={handleTeleportOrStage} deviceConnected={health.canOperate} />
        }
        rightContent={
          <TopBarActions
            onDeviceClick={(anchor) => {
              // Open the compact popover anchored to the clicked button.
              // "Manage" inside escalates to the full DeviceDrawer.
              setDevicesPopoverAnchor(anchor.getBoundingClientRect())
            }}
            onLibraryClick={() => setLibraryOpen(true)}
            onSettingsClick={() => setSettingsOpen(prev => !prev)}
            onFlyToCoordinate={handleFlyToCoordinate}
            onPcLocated={setPcMarkerCoord}
          />
        }
      />

      <BottomDock />

      <BottomModeBar activeMode={sim.mode} onModeChange={sim.setMode} lastRouteSubMode={lastRouteSubMode} />
      <SettingsMenu open={settingsOpen} onClose={() => setSettingsOpen(false)} layerKey={layerKey} onLayerChange={handleLayerChange} />
      <DevicesPopover
        anchor={devicesPopoverAnchor}
        onClose={() => setDevicesPopoverAnchor(null)}
      />
      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <SaveRouteDialog open={saveRouteOpen} onClose={() => setSaveRouteOpen(false)} />
    </div>
  )
}

export default App
