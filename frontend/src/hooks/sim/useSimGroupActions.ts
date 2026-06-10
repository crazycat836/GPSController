/**
 * Group-mode fan-out actions — the multi-device counterparts of the
 * single-device handlers in `useSimulation` (teleportAll, navigateAll, …).
 *
 * Each action takes an explicit list of udids so the caller (App.tsx via
 * SimContext) decides which devices to target, and returns a
 * `FanoutOutcome` for toast summarisation.
 *
 * The hook owns no state: everything the fan-outs read (speed / pause /
 * lap state, the primary position for pre-sync) and everything they patch
 * afterwards (restoreAll's runtime + overlay resets) comes in through the
 * deps bundle, so the callbacks keep the exact identities and semantics
 * they had inside `useSimulation`.
 */

import { useCallback } from 'react'
import * as api from '../../services/api'
import { PRE_SYNC_SETTLE_MS } from '../../lib/constants'
import { devWarn } from '../../lib/dev-log'
import type { LatLng } from './types'
import type { RuntimesMap } from './useSimRuntimes'
import type { PauseSetting } from './usePauseSettings'
import type { MoveMode, SpeedPrefs } from './useSpeedPrefs'

export interface FanoutOutcome<T> {
  ok: Array<{ udid: string; value: T }>
  failed: Array<{ udid: string; reason: string }>
}

function summarizeResults<T>(
  results: PromiseSettledResult<T>[],
  udids: string[],
): FanoutOutcome<T> {
  const ok: FanoutOutcome<T>['ok'] = []
  const failed: FanoutOutcome<T>['failed'] = []
  results.forEach((r, i) => {
    const udid = udids[i]
    if (r.status === 'fulfilled') ok.push({ udid, value: r.value })
    else failed.push({ udid, reason: r.reason?.message ?? String(r.reason) })
  })
  return { ok, failed }
}

export interface SimGroupActionsDeps {
  /** Primary device's current position — the pre-sync teleport target. */
  currentPosition: LatLng | null
  moveMode: MoveMode
  customSpeedKmh: number | null
  speedMinKmh: number | null
  speedMaxKmh: number | null
  straightLine: boolean
  pauseLoop: PauseSetting
  pauseMultiStop: PauseSetting
  pauseRandomWalk: PauseSetting
  loopLapCount: number | null
  setLapProgress: (v: { current: number; total: number | null } | null) => void
  // restoreAll patches runtimes / overlay state after the fan-out so the
  // map reflects the wipe without waiting for events. The setters come in
  // as inputs (all referentially stable React setters) rather than the
  // hook reaching back into useSimulation's state.
  setRuntimes: React.Dispatch<React.SetStateAction<RuntimesMap>>
  setDestination: (v: null) => void
  setWaypoints: (v: LatLng[]) => void
  setWaypointProgress: (v: null) => void
  setEffectiveSpeed: (v: null) => void
}

export function useSimGroupActions(deps: SimGroupActionsDeps) {
  const {
    currentPosition,
    moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh,
    straightLine,
    pauseLoop, pauseMultiStop, pauseRandomWalk,
    loopLapCount,
    setLapProgress,
    setRuntimes, setDestination, setWaypoints,
    setWaypointProgress, setEffectiveSpeed,
  } = deps

  const fanout = useCallback(async <T,>(
    udids: string[],
    fn: (udid: string) => Promise<T>,
  ): Promise<FanoutOutcome<T>> => {
    // Caller-gated: udids is always non-empty.
    const results = await Promise.allSettled(udids.map((u) => fn(u)))
    return summarizeResults(results, udids)
  }, [])

  // Group-mode sync helper: before any action that depends on a common start
  // (navigate / loop / multistop / randomwalk / joystick), teleport every
  // target device to the primary's current position so both phones begin from
  // the same coordinate and follow identical paths.
  //
  // Pre-sync failures are non-fatal — the primary action proceeds — but we
  // log them in dev so a half-synced fan-out doesn't disappear silently.
  // (The previous try/catch wrapped Promise.allSettled, which never rejects,
  // so failures were being swallowed by an unreachable handler.)
  const preSyncStart = useCallback(async (udids: string[]) => {
    if (udids.length < 2) return
    const pos = currentPosition
    if (!pos) return
    const results = await Promise.allSettled(
      udids.map((u) => api.teleport(pos.lat, pos.lng, u)),
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        devWarn('[preSyncStart] teleport failed for', udids[i], r.reason)
      }
    })
    // Tiny settle delay so devices finalise the teleport before the next
    // command arrives.
    await new Promise((r) => setTimeout(r, PRE_SYNC_SETTLE_MS))
  }, [currentPosition])

  const teleportAll = useCallback((udids: string[], lat: number, lng: number) =>
    fanout(udids, (u) => api.teleport(lat, lng, u)), [fanout])
  const navigateAll = useCallback(async (udids: string[], lat: number, lng: number) => {
    await preSyncStart(udids)
    return fanout(udids, (u) => api.navigate(lat, lng, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, u, straightLine))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, straightLine])
  const startLoopAll = useCallback(async (udids: string[], wps: LatLng[]) => {
    await preSyncStart(udids)
    setLapProgress(loopLapCount != null ? { current: 0, total: loopLapCount } : null)
    return fanout(udids, (u) => api.startLoop(wps, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseLoop.enabled, pause_min: pauseLoop.min, pause_max: pauseLoop.max }, u, straightLine, loopLapCount))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseLoop, straightLine, loopLapCount])
  const multiStopAll = useCallback(async (udids: string[], wps: LatLng[], dur: number, loop: boolean) => {
    await preSyncStart(udids)
    setLapProgress(loop && loopLapCount != null ? { current: 0, total: loopLapCount } : null)
    return fanout(udids, (u) => api.multiStop(wps, moveMode, dur, loop, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseMultiStop.enabled, pause_min: pauseMultiStop.min, pause_max: pauseMultiStop.max }, u, straightLine, loop ? loopLapCount : null))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, straightLine, loopLapCount])
  const randomWalkAll = useCallback(async (udids: string[], center: LatLng, r: number) => {
    await preSyncStart(udids)
    // Shared seed → both engines produce identical destination sequences.
    const seed = udids.length >= 2 ? Date.now() : null
    return fanout(udids, (u) => api.randomWalk(center, r, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseRandomWalk.enabled, pause_min: pauseRandomWalk.min, pause_max: pauseRandomWalk.max }, u, seed, straightLine))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseRandomWalk, straightLine])
  const applySpeedAll = useCallback((udids: string[], sel?: SpeedPrefs) => {
    const s = sel ?? { moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh }
    return fanout(udids, (u) => api.applySpeed(s.moveMode, { speed_kmh: s.customSpeedKmh, speed_min_kmh: s.speedMinKmh, speed_max_kmh: s.speedMaxKmh }, u))
  }, [fanout, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh])
  const pauseAll = useCallback((udids: string[]) => fanout(udids, (u) => api.pauseSim(u)), [fanout])
  const resumeAll = useCallback((udids: string[]) => fanout(udids, (u) => api.resumeSim(u)), [fanout])
  const stopAll = useCallback((udids: string[]) => fanout(udids, (u) => api.stopSim(u)), [fanout])
  const restoreAll = useCallback(async (udids: string[]) => {
    const outcome = await fanout(udids, (u) => api.restoreSim(u))
    // Clear per-device runtime state (markers, routes) so the map — and
    // the single-device view derived from the primary runtime —
    // immediately reflects the wipe without waiting for events.
    setRuntimes((prev) => {
      const next: RuntimesMap = { ...prev }
      for (const u of udids) {
        if (next[u]) {
          next[u] = { ...next[u], currentPos: null, destination: null, routePath: [], progress: 0, eta: null, distanceRemaining: 0, distanceTraveled: 0, waypointIndex: null, state: 'idle' }
        }
      }
      return next
    })
    setDestination(null)
    setWaypoints([])
    setWaypointProgress(null)
    setLapProgress(null)
    setEffectiveSpeed(null)
    return outcome
  }, [fanout])
  const joystickStartAll = useCallback(async (udids: string[]) => {
    await preSyncStart(udids)
    return fanout(udids, (u) => api.joystickStart(moveMode, u))
  }, [fanout, preSyncStart, moveMode])
  const joystickStopAll = useCallback((udids: string[]) =>
    fanout(udids, (u) => api.joystickStop(u)), [fanout])

  return {
    teleportAll,
    navigateAll,
    startLoopAll,
    multiStopAll,
    randomWalkAll,
    applySpeedAll,
    pauseAll,
    resumeAll,
    stopAll,
    restoreAll,
    joystickStartAll,
    joystickStopAll,
  }
}
