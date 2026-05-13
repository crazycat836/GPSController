import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSimulation, SimMode, MoveMode } from '../hooks/useSimulation'
import type { FanoutOutcome, SimErrorCode } from '../hooks/useSimulation'
import { useJoystick } from '../hooks/useJoystick'
import * as api from '../services/api'
import {
  RANDOM_GEN_COUNT_MAX,
  RANDOM_GEN_COUNT_MIN,
  RANDOM_GEN_RADIUS_MAX_M,
  RANDOM_GEN_RADIUS_MIN_M,
  RESTORE_MIN_DISPLAY_MS,
  SPEED_MAP,
} from '../lib/constants'
import { devWarn } from '../lib/dev-log'
import { generateRandomTour } from '../lib/waypoint_gen'
import { useDeviceContext } from './DeviceContext'
import { useToastContext } from './ToastContext'
import { useWebSocketContext } from './WebSocketContext'
import { useSimSettings } from './SimSettingsContext'
import { useT } from '../i18n'
import type { StringKey } from '../i18n'
import ConfirmDialog from '../components/ui/ConfirmDialog'

// Translator keys for hook-emitted error codes (`SimErrorCode`). Defined
// here so SimContext can hand `useSimulation` a code → localised string
// function without baking i18n knowledge into the hook itself.
const SIM_ERROR_KEYS: Record<SimErrorCode, StringKey> = {
  tunnel_lost: 'err.tunnel_lost',
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

// Threshold at which a list of connected devices switches the action
// from "single device call" to "fan-out across all devices". Kept here
// (rather than as a magic `>= 2` in every handler) so the rule has one
// definition.
const FANOUT_MIN_DEVICES = 2

// Most "do an action" handlers in this file share the same shape:
//   if 2+ devices → await sim.xAll(udids, …) → showToast(toastForFanout(…))
//   else          → sim.x(…)  (sometimes async, sometimes sync)
//
// `runWithFanout` collapses that branch into one call site. Callers
// supply the resolved udids/devices, the toast label, and two thunks:
// `single` for the 1-device path and `multi` for the fan-out. Anything
// outside that shape (optimistic writes, pre-gates like
// `confirmStartFromCached`, success toasts on the single path, custom
// outcome handling) stays in the caller — that's intentional, the
// helper exists for the common case, not to be a do-everything wrapper.
async function runWithFanout<T>(params: {
  udids: string[]
  devices: { udid: string }[]
  action: string
  // `single` may be sync (e.g. `sim.pause()`) or async (e.g.
  // `sim.teleport(...)` which returns `Promise<StatusResponse>`). The
  // return value is intentionally ignored — the helper only cares that
  // the call has finished before resolving.
  single: () => unknown
  multi: (udids: string[]) => Promise<FanoutOutcome<T>>
  t: (k: StringKey, v?: Record<string, string | number>) => string
  showToast: (msg: string) => void
}): Promise<void> {
  const { udids, devices, action, single, multi, t, showToast } = params
  if (udids.length >= FANOUT_MIN_DEVICES) {
    const outcome = await multi(udids)
    showToast(toastForFanout(t, action, outcome, devices))
  } else {
    await single()
  }
}

// Re-export `SPEED_MAP` so existing consumers (`App.tsx`,
// `SimDerivedContext`) keep importing it through `contexts/SimContext`.
// The canonical definition lives in `lib/constants.ts` next to
// `SPEED_PRESETS` so the two cannot drift.
export { SPEED_MAP }

interface SimContextValue {
  // From useSimulation — full simulation state passthrough.
  sim: ReturnType<typeof useSimulation>
  // From useJoystick — direction/intensity for the active joystick UI.
  joystick: ReturnType<typeof useJoystick>
  // Action dispatchers. Settings (randomWalkRadius / wpGen* / cooldown)
  // live in `SimSettingsContext` and derived values
  // (currentPos / destPos / displaySpeed / isRunning / isPaused) live in
  // `SimDerivedContext`; both expose their own hooks.
  handleTeleport: (lat: number, lng: number) => void
  handleNavigate: (lat: number, lng: number) => void
  handleStart: () => void
  handleStop: () => void
  handlePause: () => void
  handleResume: () => void
  handleRestore: () => void
  handleApplySpeed: () => Promise<void>
  handleAddWaypoint: (lat: number, lng: number) => void
  handleClearWaypoints: () => void
  handleRemoveWaypoint: (index: number) => void
  handleGenerateRandomWaypoints: () => void
  handleGenerateAllRandom: () => void
  handleOpenLog: () => void
  handleSetTeleportDest: (lat: number, lng: number) => void
  handleClearTeleportDest: () => void
  handleMapClick: (lat: number, lng: number) => void
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

  // Settings live in `SimSettingsContext`. Handlers below pull values
  // from there; consumers that read settings directly should call
  // `useSimSettings()` not `useSimContext()`.
  const {
    randomWalkRadius,
    wpGenRadius,
    setWpGenRadius,
    wpGenCount,
    setWpGenCount,
  } = useSimSettings()

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
  // Surface a user-facing hint when the backend reports a DDI mount
  // failure. `ts` on the signal dedupes repeat failures across
  // re-renders; reason + stage go to the console only in dev.
  const lastDdiMissingTs = React.useRef<number>(0)
  useEffect(() => {
    const m = sim.ddiMissing
    if (!m) return
    if (m.ts === lastDdiMissingTs.current) return
    lastDdiMissingTs.current = m.ts
    devWarn('[ddi_mount_missing]', m.stage ?? '?', m.reason)
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
    sim.setWaypoints(generateRandomTour(sim.currentPosition, radius, count))
  }, [sim, showToast, t])

  const handleGenerateRandomWaypoints = useCallback(() => {
    generateWaypoints(wpGenRadius, wpGenCount)
  }, [generateWaypoints, wpGenRadius, wpGenCount])

  const handleGenerateAllRandom = useCallback(() => {
    // Inclusive on both ends — `+ 1` widens the open upper bound so MAX is
    // reachable. See constants for the numeric bounds.
    const radius = Math.floor(
      RANDOM_GEN_RADIUS_MIN_M + Math.random() * (RANDOM_GEN_RADIUS_MAX_M - RANDOM_GEN_RADIUS_MIN_M + 1),
    )
    const count = Math.floor(
      RANDOM_GEN_COUNT_MIN + Math.random() * (RANDOM_GEN_COUNT_MAX - RANDOM_GEN_COUNT_MIN + 1),
    )
    setWpGenRadius(radius)
    setWpGenCount(count)
    generateWaypoints(radius, count)
  }, [generateWaypoints, setWpGenRadius, setWpGenCount])

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
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('mode.teleport'),
        single: () => sim.teleport(lat, lng),
        multi: (us) => {
          // Optimistic write — only on the multi path, where `teleport`
          // doesn't update currentPosition itself the way the single
          // path does. Lives in the multi thunk so it only runs when
          // the multi branch is taken.
          sim.setCurrentPosition({ lat, lng })
          return sim.teleportAll(us, lat, lng)
        },
        t,
        showToast,
      })
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t('err.teleport_failed'))
    }
  }, [sim, device, t, showToast])

  const handleNavigate = useCallback(async (latIn: number, lngIn: number) => {
    const lat = clampLat(latIn)
    const lng = normalizeLng(lngIn)
    const udids = device.connectedDevices.map((d) => d.udid)
    try {
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('mode.navigate'),
        // Single-device path is gated on `confirmStartFromCached` so
        // the user has to consent before we teleport from a cached
        // position. The multi path runs its own preSyncStart inside
        // `navigateAll`, so the gate is single-only.
        single: async () => {
          if (!(await confirmStartFromCached())) return
          await sim.navigate(lat, lng)
        },
        multi: (us) => sim.navigateAll(us, lat, lng),
        t,
        showToast,
      })
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
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('mode.loop'),
        single: () => sim.startLoop(route),
        multi: (us) => sim.startLoopAll(us, route),
        t,
        showToast,
      })
    } else if (sim.mode === SimMode.MultiStop) {
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('mode.multi_stop'),
        // Single-device multi-stop is gated on the cached-position
        // confirm prompt; the multi path runs preSyncStart server-side.
        single: async () => {
          if (!(await confirmStartFromCached())) return
          sim.multiStop(route, 0, false)
        },
        multi: (us) => sim.multiStopAll(us, route, 0, false),
        t,
        showToast,
      })
    }
  }, [sim, device, showToast, t, confirmStartFromCached])

  const handleStart = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (sim.mode === SimMode.Joystick) {
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('mode.joystick'),
        single: () => sim.joystickStart(),
        multi: (us) => sim.joystickStartAll(us),
        t,
        showToast,
      })
    } else if (sim.mode === SimMode.RandomWalk) {
      if (!sim.currentPosition) {
        showToast(t('toast.no_position_random'))
        return
      }
      const startPos = sim.currentPosition
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('mode.random_walk'),
        // Single-device path: gate on confirm, then re-read position
        // (the confirm flow may have teleported to a confirmed cached
        // coord, so `sim.currentPosition` may differ from `startPos`).
        single: async () => {
          if (!(await confirmStartFromCached())) return
          const pos = sim.currentPosition
          if (pos) sim.randomWalk(pos, randomWalkRadius)
        },
        multi: (us) => sim.randomWalkAll(us, startPos, randomWalkRadius),
        t,
        showToast,
      })
    } else if (sim.mode === SimMode.Navigate) {
      const dest = sim.destination
      if (!dest) {
        showToast(t('toast.no_destination'))
        return
      }
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('mode.navigate'),
        single: async () => {
          if (!(await confirmStartFromCached())) return
          await sim.navigate(dest.lat, dest.lng)
        },
        multi: (us) => sim.navigateAll(us, dest.lat, dest.lng),
        t,
        showToast,
      })
    } else if (sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop) {
      // `handleStartWaypointRoute` performs an async fan-out + may await
      // a confirm prompt. Await so any rejection propagates into this
      // callback's caller (BottomDock catches it and toasts).
      await handleStartWaypointRoute()
    }
  }, [sim, device, randomWalkRadius, handleStartWaypointRoute, showToast, t, confirmStartFromCached])

  const handleStop = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    // Joystick fan-out has no single-device fallback in this handler
    // (single-device joystick stop happens via the joystick UI itself),
    // so it stays inline rather than going through `runWithFanout`.
    if (sim.mode === SimMode.Joystick && udids.length >= 2) {
      const outcome = await sim.joystickStopAll(udids)
      showToast(toastForFanout(t, t('mode.joystick'), outcome, device.connectedDevices))
      return
    }
    await runWithFanout({
      udids,
      devices: device.connectedDevices,
      action: t('generic.stop'),
      single: () => sim.stop(),
      multi: (us) => sim.stopAll(us),
      t,
      showToast,
    })
  }, [sim, device, t, showToast])

  const handleApplySpeed = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    try {
      await runWithFanout({
        udids,
        devices: device.connectedDevices,
        action: t('panel.apply_speed_success'),
        // Single-device path needs an explicit success toast — the multi
        // path gets one through toastForFanout, single does not.
        single: async () => {
          await sim.applySpeed()
          showToast(t('panel.apply_speed_success'))
        },
        multi: (us) => sim.applySpeedAll(us),
        t,
        showToast,
      })
    } catch (err: unknown) {
      showToast(t('panel.apply_speed_failed') + (err instanceof Error ? `: ${err.message}` : ''))
    }
  }, [sim, device, showToast, t])

  const handlePause = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    await runWithFanout({
      udids,
      devices: device.connectedDevices,
      action: t('generic.pause'),
      single: () => sim.pause(),
      multi: (us) => sim.pauseAll(us),
      t,
      showToast,
    })
  }, [sim, device, t, showToast])

  const handleResume = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    await runWithFanout({
      udids,
      devices: device.connectedDevices,
      action: t('generic.resume'),
      single: () => sim.resume(),
      multi: (us) => sim.resumeAll(us),
      t,
      showToast,
    })
  }, [sim, device, t, showToast])

  const handleOpenLog = useCallback(async () => {
    try {
      await api.openLogFolder()
    } catch (err: unknown) {
      showToast(t('status.open_log_failed') + (err instanceof Error ? `: ${err.message}` : ''))
    }
  }, [showToast, t])

  // Derived values (currentPos / destPos / displaySpeed / isRunning /
  // isPaused) live in SimDerivedContext — single source via
  // `lib/sim-derive.ts`, no duplicate computation here.
  const value = useMemo<SimContextValue>(() => ({
    sim,
    joystick,
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
    handleAddWaypoint,
    handleClearWaypoints,
    handleRemoveWaypoint,
    handleGenerateRandomWaypoints,
    handleGenerateAllRandom,
    handleOpenLog,
    handleMapClick,
  }), [
    sim,
    joystick,
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
    handleAddWaypoint,
    handleClearWaypoints,
    handleRemoveWaypoint,
    handleGenerateRandomWaypoints,
    handleGenerateAllRandom,
    handleOpenLog,
    handleMapClick,
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
