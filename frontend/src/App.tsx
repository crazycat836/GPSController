import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Smartphone, Wifi, Usb } from 'lucide-react'
import { useT } from './i18n'
import { useWebSocket } from './hooks/useWebSocket'
import { SimMode } from './hooks/useSimulation'
import { STORAGE_KEYS } from './lib/storage-keys'

// Context providers
import { ToastProvider, useToastContext } from './contexts/ToastContext'
import { DeviceProvider, useDeviceContext } from './contexts/DeviceContext'
import { SimProvider, useSimContext } from './contexts/SimContext'
import { BookmarkProvider, useBookmarkContext } from './contexts/BookmarkContext'

// Components
import MapView from './components/MapView'
import JoystickPad from './components/JoystickPad'
import EtaBar from './components/EtaBar'
import UpdateChecker from './components/UpdateChecker'
// Shell components
import FloatingPanel from './components/shell/FloatingPanel'
import TopBar from './components/shell/TopBar'
import SearchBar from './components/shell/SearchBar'
import ModeToolbar from './components/shell/ModeToolbar'
import MiniStatusBar from './components/shell/MiniStatusBar'
import SettingsMenu from './components/shell/SettingsMenu'
import CooldownBadge from './components/shell/CooldownBadge'
import Toast from './components/shell/Toast'

// Panels
import TeleportPanel from './components/panels/TeleportPanel'
import NavigatePanel from './components/panels/NavigatePanel'
import LoopPanel from './components/panels/LoopPanel'
import MultiStopPanel from './components/panels/MultiStopPanel'
import RandomWalkPanel from './components/panels/RandomWalkPanel'
import JoystickPanel from './components/panels/JoystickPanel'

// Modals/Drawers
import DeviceDrawer from './components/device/DeviceDrawer'
import LibraryDrawer from './components/modals/LibraryDrawer'

// Root component — just providers
const App: React.FC = () => {
  const ws = useWebSocket()
  return (
    <ToastProvider>
      <DeviceProvider subscribe={ws.subscribe}>
        <SimProvider subscribe={ws.subscribe} sendMessage={ws.sendMessage}>
          <BookmarkProvider>
            <AppShell wsConnected={ws.connected} />
          </BookmarkProvider>
        </SimProvider>
      </DeviceProvider>
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

// Inner shell — consumes all contexts
function AppShell({ wsConnected }: { wsConnected: boolean }) {
  const t = useT()
  const toast = useToastContext()
  const device = useDeviceContext()
  const simCtx = useSimContext()
  const bm = useBookmarkContext()
  const { sim, joystick, handlePause, handleResume } = simCtx

  // UI state
  const [deviceDrawerOpen, setDeviceDrawerOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [layerKey, setLayerKey] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.tileLayer) || 'osm' } catch { return 'osm' }
  })
  const handleLayerChange = useCallback((key: string) => {
    setLayerKey(key)
    try { localStorage.setItem(STORAGE_KEYS.tileLayer, key) } catch {}
  }, [])

  // Auto-scan on WebSocket connect
  useEffect(() => {
    if (wsConnected) device.scan()
  }, [wsConnected])

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
        if (deviceDrawerOpen) { setDeviceDrawerOpen(false); return }
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
  }, [libraryOpen, deviceDrawerOpen, sim, handlePause, handleResume])

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <div className="noise-overlay" aria-hidden />

      {/* Full-screen map layer */}
      <div className="absolute inset-0">
        <EtaBar
          runtimes={sim.runtimes}
          state={sim.status?.state ?? 'idle'}
          progress={sim.progress}
          remainingDistance={sim.status?.distance_remaining ?? 0}
          traveledDistance={sim.status?.distance_traveled ?? 0}
          eta={sim.eta ?? 0}
        />

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
          runtimes={sim.runtimes}
          devices={device.connectedDevices}
          currentPosition={simCtx.currentPos}
          destination={simCtx.destPos}
          waypoints={sim.waypoints.map((w: any, i: number) => ({ ...w, index: i }))}
          routePath={sim.routePath}
          randomWalkRadius={
            sim.mode === SimMode.RandomWalk ? simCtx.randomWalkRadius :
            (sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop) ? simCtx.wpGenRadius :
            null
          }
          onMapClick={simCtx.handleMapClick}
          onTeleport={simCtx.handleTeleport}
          onNavigate={simCtx.handleNavigate}
          onAddBookmark={bm.handleAddBookmark}
          onAddWaypoint={simCtx.handleAddWaypoint}
          showWaypointOption={sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop || sim.mode === SimMode.Navigate}
          deviceConnected={device.connectedDevice !== null}
          onShowToast={toast.showToast}
          layerKey={layerKey}
          onLayerChange={handleLayerChange}
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
                if (e.key === 'Enter') bm.submitAddBookmark()
                if (e.key === 'Escape') bm.setAddBmDialog(null)
              }}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <select
              value={bm.addBmDialog.category}
              onChange={(e) => bm.setAddBmDialog({ ...bm.addBmDialog!, category: e.target.value })}
              style={{
                width: '100%', marginBottom: 10, padding: '6px 8px',
                background: 'var(--color-surface-2)', color: 'var(--color-text-1)', border: '1px solid var(--color-border)',
                borderRadius: 4, fontSize: 12,
              }}
            >
              {bm.categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
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

        {/* Device chip — bottom-left */}
        <button
          onClick={() => setDeviceDrawerOpen(true)}
          className="absolute bottom-3 left-3 z-[var(--z-ui)] surface-control rounded-lg px-3 py-2 flex items-center gap-2.5 text-xs cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <div className="relative">
            <Smartphone className="w-4 h-4 text-[var(--color-text-2)]" />
            <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-[var(--color-surface-1)] ${device.connectedDevices.length > 0 ? 'bg-green-400' : 'bg-red-400'}`} />
          </div>
          {device.connectedDevices.length > 0 ? (
            device.connectedDevices.map((d, i) => (
              <span key={d.udid} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[var(--color-text-3)]">/</span>}
                <span className="text-[var(--color-text-1)] font-medium">{d.name}</span>
                {d.connection_type === 'Network'
                  ? <Wifi className="w-3 h-3 text-green-400" />
                  : <Usb className="w-3 h-3 text-[var(--color-accent)]" />}
              </span>
            ))
          ) : (
            <span className="text-[var(--color-text-3)]">{t('status.disconnected')}</span>
          )}
        </button>

        <MiniStatusBar />
        <CooldownBadge />
        <UpdateChecker />

        <Toast key={toast.toastMsg ?? ''} visible={!!toast.toastMsg}>
          {toast.toastMsg}
        </Toast>
      </div>

      {/* Floating overlay components */}
      <TopBar
        onLibraryClick={() => setLibraryOpen(true)}
        onSettingsClick={() => setSettingsOpen(prev => !prev)}
        onAddDevice={() => {
          if (device.connectedDevices.length >= 2) {
            toast.showToast(t('device.max_reached'))
            return
          }
          device.scan()
          setDeviceDrawerOpen(true)
        }}
        addDeviceDisabled={device.connectedDevices.length >= 2}
        leftContent={
          <SearchBar onTeleport={simCtx.handleTeleport} deviceConnected={device.connectedDevice !== null} />
        }
      />

      <FloatingPanel mode={sim.mode} key={sim.mode}>
        {sim.mode === SimMode.Teleport && <TeleportPanel />}
        {sim.mode === SimMode.Navigate && <NavigatePanel />}
        {sim.mode === SimMode.Loop && <LoopPanel />}
        {sim.mode === SimMode.MultiStop && <MultiStopPanel />}
        {sim.mode === SimMode.RandomWalk && <RandomWalkPanel />}
        {sim.mode === SimMode.Joystick && <JoystickPanel />}
      </FloatingPanel>

      <ModeToolbar activeMode={sim.mode} onModeChange={sim.setMode} />
      <SettingsMenu open={settingsOpen} onClose={() => setSettingsOpen(false)} layerKey={layerKey} onLayerChange={handleLayerChange} />
      <DeviceDrawer open={deviceDrawerOpen} onClose={() => setDeviceDrawerOpen(false)} />
      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </div>
  )
}

export default App
