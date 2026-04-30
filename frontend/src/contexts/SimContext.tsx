import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSimulation, SimMode, MoveMode } from '../hooks/useSimulation'
import type { FanoutOutcome, SimErrorCode } from '../hooks/useSimulation'
import { useJoystick } from '../hooks/useJoystick'
import * as api from '../services/api'
import type { CooldownStatusResponse } from '../services/api'
import {
  DEFAULT_RANDOM_WALK_RADIUS,
  DEFAULT_WP_GEN_RADIUS,
  RESTORE_MIN_DISPLAY_MS,
} from '../lib/constants'
import { useDeviceContext } from './DeviceContext'
import { useToastContext } from './ToastContext'
import { useWebSocketContext } from './WebSocketContext'
import { useT } from '../i18n'
import type { StringKey } from '../i18n'
import ConfirmDialog from '../components/ui/ConfirmDialog'

// Translator keys for hook-emitted error codes (`SimErrorCode`). Defined
// here so SimContext can hand `useSimulation` a code → localised string
// function without baking i18n knowledge into the hook itself.
const SIM_ERROR_KEYS: Record<SimErrorCode, StringKey> = {
  tunnel_lost: 'err.tunnel_lost',
  simulation_error: 'err.simulation_error',
  no_device_connected: 'err.no_device',
}

// Re-export for consumers
export { SimMode, MoveMode }

// Pure coordinate helpers — module-level so they're allocated once.
const normalizeLng = (lng: number): number => {
  const n = ((lng + 180) % 360 + 360) % 360 - 180
  return lng === 180 ? 180 : n
}
const clampLat = (lat: number): number => Math.max(-90, Math.min(90, lat))

// Summarise a group fan-out result into a single toast string.
export function toastForFanout<T>(
  t: (k: StringKey, v?: Record<string, string | number>) => string,
  action: string,
  outcome: FanoutOutcome<T>,
  devices: { udid: string }[],
): string {
  const total = outcome.ok.length + outcome.failed.length
  if (total === 0) return action
  if (outcome.failed.length === 0) return t('group.action_all_success', { action })
  if (outcome.ok.length === 0) return t('group.action_all_failed', { action })
  const statusFor = (udid: string) =>
    outcome.ok.some((o) => o.udid === udid) ? 'OK'
      : outcome.failed.find((f) => f.udid === udid)?.reason ?? 'error'
  return t('group.action_partial', {
    action,
    aStatus: devices[0] ? statusFor(devices[0].udid) : '-',
    bStatus: devices[1] ? statusFor(devices[1].udid) : '-',
  })
}

// km/h. Must stay in sync with `BottomDock.SPEED_PRESETS`,
// `SpeedControls.SPEED_PRESETS`, and backend `SPEED_PROFILES`.
export const SPEED_MAP: Record<MoveMode, number> = {
  walking: 10.8,
  running: 19.8,
  driving: 60,
}

interface SimContextValue {
  // From useSimulation - pass through everything
  sim: ReturnType<typeof useSimulation>
  // From useJoystick
  joystick: ReturnType<typeof useJoystick>
  // Local state
  randomWalkRadius: number
  setRandomWalkRadius: (r: number) => void
  wpGenRadius: number
  setWpGenRadius: (r: number) => void
  wpGenCount: number
  setWpGenCount: (c: number) => void
  cooldown: number
  cooldownEnabled: boolean
  // Handlers
  handleTeleport: (lat: number, lng: number) => void
  handleNavigate: (lat: number, lng: number) => void
  handleStart: () => void
  handleStop: () => void
  handlePause: () => void
  handleResume: () => void
  handleRestore: () => void
  handleApplySpeed: () => Promise<void>
  handleToggleCooldown: (enabled: boolean) => void
  handleAddWaypoint: (lat: number, lng: number) => void
  handleClearWaypoints: () => void
  handleRemoveWaypoint: (index: number) => void
  handleGenerateRandomWaypoints: () => void
  handleGenerateAllRandom: () => void
  handleOpenLog: () => void
  handleSetTeleportDest: (lat: number, lng: number) => void
  handleClearTeleportDest: () => void
  handleMapClick: (lat: number, lng: number) => void
  // Derived
  displaySpeed: number | string
  isRunning: boolean
  isPaused: boolean
  currentPos: { lat: number; lng: number } | null
  destPos: { lat: number; lng: number } | null
  speed: number
}

const SimContext = createContext<SimContextValue | null>(null)

interface SimProviderProps {
  children: React.ReactNode
}

export function SimProvider({ children }: SimProviderProps) {
  const t = useT()
  const device = useDeviceContext()
  const { showToast } = useToastContext()
  const { subscribe, sendMessage } = useWebSocketContext()
  // Stable translator: looks up the latest `t` via ref so the function
  // identity passed to `useSimulation` doesn't churn on every i18n
  // re-render and tear down the hook's WS subscriber.
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])
  const translateError = useCallback((code: SimErrorCode): string => {
    return tRef.current(SIM_ERROR_KEYS[code])
  }, [])
  const sim = useSimulation(subscribe, { translateError })
  const joystick = useJoystick(
    (type, data) => sendMessage(type, { ...data }),
    sim.mode === SimMode.Joystick,
  )

  const [cooldown, setCooldown] = useState(0)
  const [cooldownEnabled, setCooldownEnabled] = useState(false)

  // ── Start-from-cached-position confirmation ────────────────────────
  // After a server restart the UI rehydrates the last-known position
  // purely for display; the backend engine is intentionally left idle
  // so it doesn't stomp on the phone's real GPS. The first movement
  // action (navigate / multi-stop / random-walk) therefore needs the
  // user's explicit consent before we teleport. `pendingSync` holds the
  // action to resume once the user confirms; it's null when no prompt
  // is active. Using a ref for the callback keeps the promise resolver
  // stable across re-renders.
  const pendingSyncRef = useRef<{
    position: { lat: number; lng: number }
    resolve: (ok: boolean) => void
  } | null>(null)
  const [syncPrompt, setSyncPrompt] = useState<{
    position: { lat: number; lng: number }
  } | null>(null)

  // Returns a promise that resolves to true when the user gives consent
  // (backend is synced), false if they cancel. Resolves true immediately
  // when no prompt is needed.
  const confirmStartFromCached = useCallback(async (): Promise<boolean> => {
    // Already synced this session (live position or a prior teleport) —
    // no prompt, no side effect.
    if (sim.backendPositionSynced) return true
    // No cached position to start from — let the action surface its
    // own "no position" error; prompting here wouldn't help.
    if (!sim.currentPosition) return true
    // Group mode (2+ devices) runs its own preSyncStart across all
    // engines. Prompting there would need a multi-device teleport path;
    // single-device is the only case this UX currently covers.
    const udids = device.connectedDevices.map((d) => d.udid)
    if (udids.length >= 2) return true

    const position = { lat: sim.currentPosition.lat, lng: sim.currentPosition.lng }
    return new Promise<boolean>((resolve) => {
      pendingSyncRef.current = { position, resolve }
      setSyncPrompt({ position })
    })
  }, [sim, device.connectedDevices])

  const handleSyncConfirm = useCallback(async () => {
    const pending = pendingSyncRef.current
    if (!pending) return
    try {
      await sim.teleport(pending.position.lat, pending.position.lng)
      pending.resolve(true)
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t('err.no_position'))
      pending.resolve(false)
    } finally {
      pendingSyncRef.current = null
      setSyncPrompt(null)
    }
  }, [sim, showToast, t])

  const handleSyncCancel = useCallback(() => {
    const pending = pendingSyncRef.current
    if (pending) pending.resolve(false)
    pendingSyncRef.current = null
    setSyncPrompt(null)
  }, [])
  const [randomWalkRadius, setRandomWalkRadius] = useState(DEFAULT_RANDOM_WALK_RADIUS)
  const [wpGenRadius, setWpGenRadius] = useState(DEFAULT_WP_GEN_RADIUS)
  const [wpGenCount, setWpGenCount] = useState(5)

  // Surface a user-facing hint when the backend reports a DDI mount
  // failure. `ts` on the signal dedupes repeat failures across
  // re-renders; reason + stage go to the console only in dev.
  const lastDdiMissingTs = React.useRef<number>(0)
  useEffect(() => {
    const m = sim.ddiMissing
    if (!m) return
    if (m.ts === lastDdiMissingTs.current) return
    lastDdiMissingTs.current = m.ts
    const isDev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
    if (isDev) {
      // eslint-disable-next-line no-console
      console.warn('[ddi_mount_missing]', m.stage ?? '?', m.reason)
    }
    showToast(t('ddi.missing_hint'), 10000)
  }, [sim.ddiMissing, showToast, t])

  // --- Handlers ---

  const handleRestore = useCallback(async () => {
    showToast(t('status.restore_in_progress'), 10000)
    const startedAt = Date.now()
    try {
      const udids = device.connectedDevices.map((d) => d.udid)
      if (udids.length >= 2) {
        const outcome = await sim.restoreAll(udids)
        if (outcome.failed.length > 0 && outcome.ok.length === 0) {
          throw new Error(outcome.failed[0]?.reason ?? 'restore failed')
        }
      } else {
        await sim.restore()
      }
      const elapsed = Date.now() - startedAt
      if (elapsed < RESTORE_MIN_DISPLAY_MS) {
        await new Promise((r) => setTimeout(r, RESTORE_MIN_DISPLAY_MS - elapsed))
      }
      showToast(t('status.restore_success_wait'))
    } catch {
      showToast(t('status.restore_failed'))
    }
  }, [showToast, t, sim, device])

  const generateWaypoints = useCallback((radius: number, count: number) => {
    if (!sim.currentPosition) {
      showToast(t('toast.no_position_random'))
      return
    }
    const { lat, lng } = sim.currentPosition
    const latScale = 111320
    const lngScale = 111320 * Math.cos((lat * Math.PI) / 180)

    type Pt = { lat: number; lng: number; theta?: number }
    const pts: Pt[] = []
    for (let i = 0; i < count; i++) {
      const r = radius * Math.sqrt(Math.random())
      const theta = Math.random() * 2 * Math.PI
      pts.push({
        lat: lat + (r * Math.cos(theta)) / latScale,
        lng: lng + (r * Math.sin(theta)) / lngScale,
        theta,
      })
    }

    const remaining = [...pts]
    const ordered: Pt[] = []
    let cx = lat, cy = lng
    while (remaining.length) {
      let bestIdx = 0, bestD = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const dx = (remaining[i].lat - cx) * latScale
        const dy = (remaining[i].lng - cy) * lngScale
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; bestIdx = i }
      }
      const [next] = remaining.splice(bestIdx, 1)
      ordered.push(next)
      cx = next.lat; cy = next.lng
    }

    sim.setWaypoints([
      { lat, lng },
      ...ordered.map(({ lat, lng }) => ({ lat, lng })),
    ])
  }, [sim, t])

  const handleGenerateRandomWaypoints = useCallback(() => {
    generateWaypoints(wpGenRadius, wpGenCount)
  }, [generateWaypoints, wpGenRadius, wpGenCount])

  const handleGenerateAllRandom = useCallback(() => {
    const radius = Math.floor(50 + Math.random() * 950)
    const count = Math.floor(3 + Math.random() * 8)
    setWpGenRadius(radius)
    setWpGenCount(count)
    generateWaypoints(radius, count)
  }, [generateWaypoints])

  const handleToggleCooldown = useCallback((enabled: boolean) => {
    setCooldownEnabled(enabled)
    api.setCooldownEnabled(enabled).catch(() => setCooldownEnabled((v) => !v))
  }, [])

  const handleMapClick = useCallback((lat: number, lng: number) => {
    const nlat = clampLat(lat)
    const nlng = normalizeLng(lng)

    switch (sim.mode) {
      case SimMode.Teleport:
      case SimMode.Navigate:
        sim.setDestination({ lat: nlat, lng: nlng })
        break
      case SimMode.Loop:
      case SimMode.MultiStop:
        sim.setWaypoints((prev) => {
          if (prev.length === 0 && sim.currentPosition) {
            return [
              { lat: sim.currentPosition.lat, lng: sim.currentPosition.lng },
              { lat: nlat, lng: nlng },
            ]
          }
          return [...prev, { lat: nlat, lng: nlng }]
        })
        break
      // RandomWalk / Joystick: no map-click action
    }
  }, [sim])

  const handleSetTeleportDest = useCallback((latIn: number, lngIn: number) => {
    const lat = clampLat(latIn)
    const lng = normalizeLng(lngIn)
    sim.setDestination({ lat, lng })
  }, [sim])

  const handleClearTeleportDest = useCallback(() => {
    sim.setDestination(null)
  }, [sim])

  const handleTeleport = useCallback(async (latIn: number, lngIn: number) => {
    const lat = clampLat(latIn)
    const lng = normalizeLng(lngIn)
    const udids = device.connectedDevices.map((d) => d.udid)
    try {
      if (udids.length >= 2) {
        sim.setCurrentPosition({ lat, lng })
        const outcome = await sim.teleportAll(udids, lat, lng)
        showToast(toastForFanout(t, t('mode.teleport'), outcome, device.connectedDevices))
      } else {
        await sim.teleport(lat, lng)
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t('err.teleport_failed'))
    }
  }, [sim, device, t, showToast])

  const handleNavigate = useCallback(async (latIn: number, lngIn: number) => {
    const lat = clampLat(latIn)
    const lng = normalizeLng(lngIn)
    const udids = device.connectedDevices.map((d) => d.udid)
    try {
      if (udids.length >= 2) {
        const outcome = await sim.navigateAll(udids, lat, lng)
        showToast(toastForFanout(t, t('mode.navigate'), outcome, device.connectedDevices))
      } else {
        if (!(await confirmStartFromCached())) return
        await sim.navigate(lat, lng)
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t('err.no_position'))
    }
  }, [sim, device, t, showToast, confirmStartFromCached])

  const handleAddWaypoint = useCallback((lat: number, lng: number) => {
    const nlat = clampLat(lat)
    const nlng = normalizeLng(lng)
    sim.setWaypoints((prev) => {
      if (prev.length === 0 && sim.currentPosition) {
        return [
          { lat: sim.currentPosition.lat, lng: sim.currentPosition.lng },
          { lat: nlat, lng: nlng },
        ]
      }
      return [...prev, { lat: nlat, lng: nlng }]
    })
  }, [sim])

  const handleClearWaypoints = useCallback(() => {
    sim.setWaypoints([])
  }, [sim])

  const handleRemoveWaypoint = useCallback((index: number) => {
    sim.setWaypoints((prev) => prev.filter((_, i) => i !== index))
  }, [sim])

  const handleStartWaypointRoute = useCallback(async () => {
    const route = sim.waypoints
    if (route.length < 2) {
      showToast(t('toast.no_waypoints'))
      return
    }
    const udids = device.connectedDevices.map((d) => d.udid)
    if (sim.mode === SimMode.Loop) {
      if (udids.length >= 2) {
        const outcome = await sim.startLoopAll(udids, route)
        showToast(toastForFanout(t, t('mode.loop'), outcome, device.connectedDevices))
      } else {
        sim.startLoop(route)
      }
    } else if (sim.mode === SimMode.MultiStop) {
      if (udids.length >= 2) {
        const outcome = await sim.multiStopAll(udids, route, 0, false)
        showToast(toastForFanout(t, t('mode.multi_stop'), outcome, device.connectedDevices))
      } else {
        if (!(await confirmStartFromCached())) return
        sim.multiStop(route, 0, false)
      }
    }
  }, [sim, device, showToast, t, confirmStartFromCached])

  const handleStart = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (sim.mode === SimMode.Joystick) {
      if (udids.length >= 2) {
        const outcome = await sim.joystickStartAll(udids)
        showToast(toastForFanout(t, t('mode.joystick'), outcome, device.connectedDevices))
      } else {
        sim.joystickStart()
      }
    } else if (sim.mode === SimMode.RandomWalk) {
      if (!sim.currentPosition) {
        showToast(t('toast.no_position_random'))
        return
      }
      if (udids.length >= 2) {
        const outcome = await sim.randomWalkAll(udids, sim.currentPosition, randomWalkRadius)
        showToast(toastForFanout(t, t('mode.random_walk'), outcome, device.connectedDevices))
      } else {
        if (!(await confirmStartFromCached())) return
        // Re-read position after the confirm path has resolved — teleport
        // above updates currentPosition to the confirmed coordinate.
        const pos = sim.currentPosition
        if (pos) sim.randomWalk(pos, randomWalkRadius)
      }
    } else if (sim.mode === SimMode.Navigate) {
      const dest = sim.destination
      if (!dest) {
        showToast(t('toast.no_destination'))
        return
      }
      if (udids.length >= 2) {
        const outcome = await sim.navigateAll(udids, dest.lat, dest.lng)
        showToast(toastForFanout(t, t('mode.navigate'), outcome, device.connectedDevices))
      } else {
        if (!(await confirmStartFromCached())) return
        await sim.navigate(dest.lat, dest.lng)
      }
    } else if (sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop) {
      // `handleStartWaypointRoute` performs an async fan-out + may await
      // a confirm prompt. Await so any rejection propagates into this
      // callback's caller (BottomDock catches it and toasts).
      await handleStartWaypointRoute()
    }
  }, [sim, device, randomWalkRadius, handleStartWaypointRoute, showToast, t, confirmStartFromCached])

  const handleStop = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (sim.mode === SimMode.Joystick && udids.length >= 2) {
      const outcome = await sim.joystickStopAll(udids)
      showToast(toastForFanout(t, t('mode.joystick'), outcome, device.connectedDevices))
      return
    }
    if (udids.length >= 2) {
      const outcome = await sim.stopAll(udids)
      showToast(toastForFanout(t, 'stop', outcome, device.connectedDevices))
    } else {
      sim.stop()
    }
  }, [sim, device, t, showToast])

  const handleApplySpeed = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    try {
      if (udids.length >= 2) {
        const outcome = await sim.applySpeedAll(udids)
        showToast(toastForFanout(t, t('panel.apply_speed_success'), outcome, device.connectedDevices))
      } else {
        await sim.applySpeed()
        showToast(t('panel.apply_speed_success'))
      }
    } catch (err: unknown) {
      showToast(t('panel.apply_speed_failed') + (err instanceof Error ? `: ${err.message}` : ''))
    }
  }, [sim, device, showToast, t])

  const handlePause = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (udids.length >= 2) {
      const outcome = await sim.pauseAll(udids)
      showToast(toastForFanout(t, 'pause', outcome, device.connectedDevices))
    } else {
      sim.pause()
    }
  }, [sim, device, t, showToast])

  const handleResume = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (udids.length >= 2) {
      const outcome = await sim.resumeAll(udids)
      showToast(toastForFanout(t, 'resume', outcome, device.connectedDevices))
    } else {
      sim.resume()
    }
  }, [sim, device, t, showToast])

  const handleOpenLog = useCallback(async () => {
    try {
      await api.openLogFolder()
    } catch (err: unknown) {
      showToast(t('status.open_log_failed') + (err instanceof Error ? `: ${err.message}` : ''))
    }
  }, [showToast, t])

  // --- Effects ---

  // Listen for cooldown updates via WebSocket (replaces polling).
  // One initial GET on mount to sync state, then all updates come via WS.
  useEffect(() => {
    // Initial sync
    api.getCooldownStatus().then((s: CooldownStatusResponse) => {
      setCooldown(s.remaining_seconds ?? 0)
      if (typeof s.enabled === 'boolean') setCooldownEnabled(s.enabled)
    }).catch(() => {})

    if (!subscribe) return
    return subscribe((msg) => {
      if (msg.type !== 'cooldown_update') return
      const d = msg.data as { remaining_seconds?: number; enabled?: boolean }
      const next = d.remaining_seconds ?? 0
      setCooldown((prev) => Math.round(prev) === Math.round(next) ? prev : next)
      if (typeof d.enabled === 'boolean') {
        const nextEnabled = d.enabled
        setCooldownEnabled((prev) => prev === nextEnabled ? prev : nextEnabled)
      }
    })
  }, [subscribe])

  // --- Derived values ---

  const currentPos = useMemo(
    () => sim.currentPosition ? { lat: sim.currentPosition.lat, lng: sim.currentPosition.lng } : null,
    [sim.currentPosition?.lat, sim.currentPosition?.lng],
  )

  const destPos = useMemo(
    () => sim.destination ? { lat: sim.destination.lat, lng: sim.destination.lng } : null,
    [sim.destination?.lat, sim.destination?.lng],
  )

  const speed = SPEED_MAP[sim.moveMode] || 5

  const fmtSpeedFromInputs = (kmh: number | null, lo: number | null, hi: number | null): number | string => {
    if (lo != null && hi != null) return `${Math.min(lo, hi)}~${Math.max(lo, hi)}`
    if (kmh != null) return kmh
    return speed
  }
  const displaySpeed: number | string = sim.status.running && sim.effectiveSpeed
    ? fmtSpeedFromInputs(sim.effectiveSpeed.kmh, sim.effectiveSpeed.min, sim.effectiveSpeed.max)
    : fmtSpeedFromInputs(sim.customSpeedKmh, sim.speedMinKmh, sim.speedMaxKmh)

  const isRunning = sim.status.running
  const isPaused = sim.status.paused

  // Memoize so every SimProvider render doesn't hand consumers a new
  // object reference (would force every `useSimContext()` user to re-render
  // regardless of which field actually changed).
  const value = useMemo<SimContextValue>(() => ({
    sim,
    joystick,
    randomWalkRadius,
    setRandomWalkRadius,
    wpGenRadius,
    setWpGenRadius,
    wpGenCount,
    setWpGenCount,
    cooldown,
    cooldownEnabled,
    handleSetTeleportDest,
    handleClearTeleportDest,
    handleTeleport,
    handleNavigate,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    handleRestore,
    handleApplySpeed,
    handleToggleCooldown,
    handleAddWaypoint,
    handleClearWaypoints,
    handleRemoveWaypoint,
    handleGenerateRandomWaypoints,
    handleGenerateAllRandom,
    handleOpenLog,
    handleMapClick,
    displaySpeed,
    isRunning,
    isPaused,
    currentPos,
    destPos,
    speed,
  }), [
    sim,
    joystick,
    randomWalkRadius,
    setRandomWalkRadius,
    wpGenRadius,
    setWpGenRadius,
    wpGenCount,
    setWpGenCount,
    cooldown,
    cooldownEnabled,
    handleSetTeleportDest,
    handleClearTeleportDest,
    handleTeleport,
    handleNavigate,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    handleRestore,
    handleApplySpeed,
    handleToggleCooldown,
    handleAddWaypoint,
    handleClearWaypoints,
    handleRemoveWaypoint,
    handleGenerateRandomWaypoints,
    handleGenerateAllRandom,
    handleOpenLog,
    handleMapClick,
    displaySpeed,
    isRunning,
    isPaused,
    currentPos,
    destPos,
    speed,
  ])

  return (
    <SimContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={syncPrompt != null}
        title={t('sync.confirm.title')}
        description={syncPrompt ? t('sync.confirm.body', {
          coord: `${syncPrompt.position.lat.toFixed(5)}, ${syncPrompt.position.lng.toFixed(5)}`,
        }) : ''}
        confirmLabel={t('sync.confirm.ok')}
        cancelLabel={t('sync.confirm.cancel')}
        onConfirm={handleSyncConfirm}
        onCancel={handleSyncCancel}
      />
    </SimContext.Provider>
  )
}

export function useSimContext() {
  const ctx = useContext(SimContext)
  if (!ctx) throw new Error('useSimContext must be used within SimProvider')
  return ctx
}
