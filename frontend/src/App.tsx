import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import type L from 'leaflet'
import { useT } from './i18n'
import { SimMode, type LatLng } from './hooks/useSimulation'
import { STORAGE_KEYS } from './lib/storage-keys'
import { haversineM, polylineDistanceM } from './lib/geo'

// Context providers
import { ToastProvider, useToastContext } from './contexts/ToastContext'
import { WebSocketProvider, useWebSocketContext } from './contexts/WebSocketContext'
import { DeviceProvider, useDeviceContext } from './contexts/DeviceContext'
import { ConnectionHealthProvider } from './contexts/ConnectionHealthContext'
import { SimProvider, useSimContext, SPEED_MAP } from './contexts/SimContext'
import { BookmarkProvider, useBookmarkContext } from './contexts/BookmarkContext'
import { AvatarProvider } from './contexts/AvatarContext'

// Components
import MapView from './components/MapView'
import JoystickPad from './components/JoystickPad'
import EtaBar from './components/EtaBar'
import UpdateChecker from './components/UpdateChecker'
// Shell components
import TopBar from './components/shell/TopBar'
import Brand from './components/shell/Brand'
import SearchBar from './components/shell/SearchBar'
import BottomModeBar from './components/shell/BottomModeBar'
import BottomDock from './components/shell/BottomDock'
import MiniStatusBar from './components/shell/MiniStatusBar'
import TopBarActions from './components/shell/TopBarActions'
import SettingsMenu from './components/shell/SettingsMenu'
import CooldownBadge from './components/shell/CooldownBadge'
import ConnectionStatusBanner from './components/shell/ConnectionStatusBanner'
import Toast from './components/shell/Toast'

// Contexts consumed inside AppShell
import { useConnectionHealth } from './contexts/ConnectionHealthContext'

// Panels
import TeleportPanel from './components/panels/TeleportPanel'
import NavigatePanel from './components/panels/NavigatePanel'
import LoopPanel from './components/panels/LoopPanel'
import MultiStopPanel from './components/panels/MultiStopPanel'
import RandomWalkPanel from './components/panels/RandomWalkPanel'
import JoystickPanel from './components/panels/JoystickPanel'

// Modals/Drawers
import DevicesPopover from './components/device/DevicesPopover'
import LibraryDrawer from './components/modals/LibraryDrawer'

// Root component — just providers.
//
// Order matters: WebSocketProvider is the single owner of the backend
// socket; everything else reads from it. DeviceProvider feeds state
// into ConnectionHealthProvider, which then fans `canOperate` /
// `hint` out to action-button consumers (panels, search bar, banner).
// SimProvider sits inside health so sim consumers can disable actions
// without duplicating the health derivation.
function App() {
  return (
    <ToastProvider>
      <WebSocketProvider>
        <DeviceProvider>
          <ConnectionHealthProvider>
            <SimProvider>
              <BookmarkProvider>
                <AvatarProvider>
                  <AppShell />
                </AvatarProvider>
              </BookmarkProvider>
            </SimProvider>
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
  const bm = useBookmarkContext()
  const health = useConnectionHealth()
  const { connected: wsConnected } = useWebSocketContext()
  const { sim, joystick, handlePause, handleResume } = simCtx

  // Static preview for the ETA bar before simulation starts.
  // Only makes sense for routed modes (Navigate / Loop / MultiStop).
  const plannedDistanceM = useMemo(() => {
    const { mode, waypoints } = sim
    if (mode === SimMode.Navigate) {
      return simCtx.currentPos && simCtx.destPos
        ? haversineM(simCtx.currentPos, simCtx.destPos)
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
  }, [sim.mode, sim.waypoints, simCtx.currentPos, simCtx.destPos])

  const plannedEtaSeconds = useMemo(() => {
    if (plannedDistanceM <= 0) return 0
    const kmh = resolveSpeedKmh(sim.customSpeedKmh, sim.speedMinKmh, sim.speedMaxKmh, sim.moveMode)
    const ms = kmh * 1000 / 3600
    return ms > 0 ? plannedDistanceM / ms : 0
  }, [plannedDistanceM, sim.customSpeedKmh, sim.speedMinKmh, sim.speedMaxKmh, sim.moveMode])

  // In Teleport mode, right-click / search sets a pending destination
  // instead of teleporting immediately. Other modes keep instant teleport.
  const handleTeleportOrStage = useCallback((lat: number, lng: number) => {
    if (sim.mode === SimMode.Teleport) {
      simCtx.handleSetTeleportDest(lat, lng)
    } else {
      simCtx.handleTeleport(lat, lng)
    }
  }, [sim.mode, simCtx])

  // UI state
  const [devicesPopoverAnchor, setDevicesPopoverAnchor] = useState<DOMRect | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // Auto-scan on WebSocket connect, debounced.
  //
  // `device` is intentionally NOT a dependency: `device.scan()` mutates
  // state that feeds into the memoized context value, which would then
  // invalidate this effect and re-fire it, producing an infinite
  // `/api/device/list` loop. We only care about the rising edge of
  // `wsConnected`. `device.scan` itself is a stable `useCallback(…, [])`
  // so reading it through the closure is safe.
  //
  // Debounce: StrictMode double-mount and dev-mode HMR can toggle
  // `wsConnected` several times within a few hundred ms. Trailing 200ms
  // collapses those into one scan per settled connect.
  const wsScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!wsConnected) return
    if (wsScanTimer.current) clearTimeout(wsScanTimer.current)
    wsScanTimer.current = setTimeout(() => { device.scan() }, 200)
    return () => {
      if (wsScanTimer.current) {
        clearTimeout(wsScanTimer.current)
        wsScanTimer.current = null
      }
    }
  }, [wsConnected])

  // Toast when a device is lost involuntarily (DVT exhausted, USB unplugged,
  // WiFi tunnel died). Fires whenever `lostUdids` grows — the set itself is
  // cleared when the device reappears, so the user only sees this on the
  // transition into lost state, not while it stays lost.
  const prevLostCount = useRef(0)
  useEffect(() => {
    const size = device.lostUdids.size
    if (size > prevLostCount.current) {
      toast.showToast(t('toast.device_lost'), 4000)
    }
    prevLostCount.current = size
  }, [device.lostUdids, toast, t])

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
      if (!isInput && e.key >= '1' && e.key <= '6') {
        const modes = [SimMode.Teleport, SimMode.Navigate, SimMode.Loop, SimMode.MultiStop, SimMode.RandomWalk, SimMode.Joystick]
        sim.setMode(modes[parseInt(e.key) - 1])
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
  }, [libraryOpen, sim, handlePause, handleResume])

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
                stroke="#6c8cff" strokeWidth="2"
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
          currentPosition={simCtx.currentPos}
          currentPositionUnsynced={!!simCtx.currentPos && !sim.backendPositionSynced}
          destination={simCtx.destPos}
          waypoints={sim.waypoints.map((w: LatLng, i: number) => ({ ...w, index: i }))}
          routePath={sim.routePath}
          randomWalkRadius={
            sim.mode === SimMode.RandomWalk ? simCtx.randomWalkRadius :
            (sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop) ? simCtx.wpGenRadius :
            null
          }
          onMapClick={simCtx.handleMapClick}
          onTeleport={handleTeleportOrStage}
          onNavigate={simCtx.handleNavigate}
          onAddBookmark={bm.handleAddBookmark}
          onAddWaypoint={simCtx.handleAddWaypoint}
          showWaypointOption={sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop || sim.mode === SimMode.Navigate}
          deviceConnected={device.connectedDevice !== null}
          onShowToast={toast.showToast}
          layerKey={layerKey}
          onLayerChange={handleLayerChange}
          onMapReady={handleMapReady}
          pcPosition={pcMarkerCoord}
        />

        {sim.mode === SimMode.Joystick && (
          <JoystickPad
            direction={joystick.direction}
            intensity={joystick.intensity}
            onMove={joystick.updateFromPad}
            onRelease={() => joystick.updateFromPad(0, 0)}
          />
        )}

        {/* Add bookmark dialog */}
        {bm.addBmDialog && createPortal(
          <div
            data-fc="modal.bookmark-add"
            onClick={(e) => e.stopPropagation()}
            className="anim-scale-in surface-popup"
            style={{
              position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
              zIndex: 'var(--z-float)', borderRadius: 'var(--radius-lg)', padding: 16, width: 300,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('bm.add')}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
              {bm.addBmDialog.lat.toFixed(5)}, {bm.addBmDialog.lng.toFixed(5)}
            </div>
            <input
              type="text"
              className="search-input"
              placeholder={t('bm.name_placeholder')}
              autoFocus
              value={bm.addBmDialog.name}
              onChange={(e) => bm.setAddBmDialog({ ...bm.addBmDialog!, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) bm.submitAddBookmark()
                if (e.key === 'Escape') bm.setAddBmDialog(null)
              }}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <select
              value={bm.addBmDialog.place}
              onChange={(e) => bm.setAddBmDialog({ ...bm.addBmDialog!, place: e.target.value })}
              style={{
                width: '100%', marginBottom: 10, padding: '6px 8px',
                background: 'var(--color-surface-2)', color: 'var(--color-text-1)', border: '1px solid var(--color-border)',
                borderRadius: 4, fontSize: 12,
              }}
            >
              {bm.places.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="action-btn primary"
                style={{ flex: 1 }}
                disabled={!bm.addBmDialog.name.trim()}
                onClick={bm.submitAddBookmark}
              >{t('generic.add')}</button>
              <button className="action-btn" onClick={() => bm.setAddBmDialog(null)}>{t('generic.cancel')}</button>
            </div>
          </div>,
          document.body,
        )}

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

      <BottomModeBar activeMode={sim.mode} onModeChange={sim.setMode} />
      <SettingsMenu open={settingsOpen} onClose={() => setSettingsOpen(false)} layerKey={layerKey} onLayerChange={handleLayerChange} />
      <DevicesPopover
        anchor={devicesPopoverAnchor}
        onClose={() => setDevicesPopoverAnchor(null)}
      />
      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </div>
  )
}

export default App
