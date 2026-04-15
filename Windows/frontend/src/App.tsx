import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from './i18n'
import { useWebSocket } from './hooks/useWebSocket'
import { SimMode } from './hooks/useSimulation'

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
import { DeviceChipRow } from './components/DeviceChipRow'

// Shell components
import FloatingPanel from './components/shell/FloatingPanel'
import TopBar from './components/shell/TopBar'
import ModeToolbar from './components/shell/ModeToolbar'
import MiniStatusBar from './components/shell/MiniStatusBar'
import SettingsMenu from './components/shell/SettingsMenu'
import CooldownBadge from './components/shell/CooldownBadge'

// Panels
import TeleportPanel from './components/panels/TeleportPanel'
import NavigatePanel from './components/panels/NavigatePanel'
import LoopPanel from './components/panels/LoopPanel'
import MultiStopPanel from './components/panels/MultiStopPanel'
import RandomWalkPanel from './components/panels/RandomWalkPanel'
import JoystickPanel from './components/panels/JoystickPanel'

// Modals/Drawers
import DeviceDrawer from './components/device/DeviceDrawer'
import SearchModal from './components/modals/SearchModal'
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  // Auto-scan on WebSocket connect
  useEffect(() => {
    if (wsConnected) device.scan()
  }, [wsConnected])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
      if ((e.metaKey && e.key === 'k') || (!isInput && e.key === '/')) {
        e.preventDefault(); setSearchOpen(true); return
      }
      if (e.metaKey && e.key === 'b') {
        e.preventDefault(); setLibraryOpen(true); return
      }
      if (e.key === 'Escape') {
        if (searchOpen) { setSearchOpen(false); return }
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
  }, [searchOpen, libraryOpen, deviceDrawerOpen, sim, handlePause, handleResume])

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
          <div className="absolute inset-0 z-[10000] bg-[rgba(20,22,32,0.85)] backdrop-blur-[3px] flex items-center justify-center">
            <div className="bg-[#23232a] border border-[#3a3a42] rounded-lg px-7 py-5 max-w-[420px] text-center shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
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
        {sim.pauseRemaining != null && sim.pauseRemaining > 0 && (
          <div className="absolute top-[38px] left-1/2 -translate-x-1/2 z-[901] bg-[rgba(255,152,0,0.95)] text-[#1a1a1a] px-3.5 py-1.5 rounded-full text-xs font-semibold shadow-md flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
            {t('toast.pause_countdown', { n: sim.pauseRemaining })}
          </div>
        )}

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
            className="anim-scale-in"
            style={{
              position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
              zIndex: 1000, background: 'rgba(26, 29, 39, 0.96)',
              backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
              border: '1px solid rgba(108, 140, 255, 0.2)',
              borderRadius: 12, padding: 16, width: 300,
              boxShadow: '0 20px 60px rgba(12, 18, 40, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
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
                background: '#1e1e22', color: '#e0e0e0', border: '1px solid #444',
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
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-[2000] bg-[var(--color-danger)] text-white px-5 py-2 rounded-md text-sm shadow-lg cursor-pointer max-w-[80%] text-center"
            onClick={sim.clearError}
          >
            {sim.error}
          </div>
        )}

        <MiniStatusBar />
        <CooldownBadge />
        <UpdateChecker />

        {toast.toastMsg && (
          <div
            key={toast.toastMsg}
            className="anim-fade-slide-down fixed top-[72px] left-1/2 -translate-x-1/2 z-[1500] bg-[var(--color-glass-heavy)] backdrop-blur-xl text-white px-[18px] py-2.5 rounded-[10px] text-sm font-medium shadow-xl border border-[var(--color-border)] max-w-[70vw] text-center"
          >
            {toast.toastMsg}
          </div>
        )}
      </div>

      {/* Floating overlay components */}
      <TopBar
        onSearchClick={() => setSearchOpen(true)}
        onLibraryClick={() => setLibraryOpen(true)}
        leftContent={
          <div onClick={() => setDeviceDrawerOpen(true)} className="cursor-pointer">
            <DeviceChipRow
              devices={device.connectedDevices}
              runtimes={sim.runtimes}
              onAdd={() => {
                if (device.connectedDevices.length >= 2) {
                  toast.showToast(t('device.max_reached'))
                  return
                }
                device.scan()
              }}
              onDisconnect={(udid) => device.disconnect(udid)}
              onRestoreOne={async (udid) => {
                try {
                  const { restoreSim } = await import('./services/api')
                  await restoreSim(udid)
                  toast.showToast(t('status.restore_success'))
                } catch (e: unknown) {
                  toast.showToast(e instanceof Error ? e.message : 'restore failed')
                }
              }}
            />
          </div>
        }
      />

      <FloatingPanel mode={sim.mode}>
        <div key={sim.mode} className="anim-fade-slide-up">
          {sim.mode === SimMode.Teleport && <TeleportPanel />}
          {sim.mode === SimMode.Navigate && <NavigatePanel />}
          {sim.mode === SimMode.Loop && <LoopPanel />}
          {sim.mode === SimMode.MultiStop && <MultiStopPanel />}
          {sim.mode === SimMode.RandomWalk && <RandomWalkPanel />}
          {sim.mode === SimMode.Joystick && <JoystickPanel />}
        </div>
      </FloatingPanel>

      <ModeToolbar activeMode={sim.mode} onModeChange={sim.setMode} />
      <SettingsMenu />
      <DeviceDrawer open={deviceDrawerOpen} onClose={() => setDeviceDrawerOpen(false)} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </div>
  )
}

export default App
