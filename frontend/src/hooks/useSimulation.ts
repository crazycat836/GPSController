import { useState, useCallback, useEffect, useRef } from 'react'
import * as api from '../services/api'
import { STORAGE_KEYS } from '../lib/storage-keys'
import { PRE_SYNC_SETTLE_MS } from '../lib/constants'
import type { LatLng } from './sim/types'
import {
  useSimRuntimes,
  emptyRuntime,
  type DeviceRuntime,
  type RuntimesMap,
} from './sim/useSimRuntimes'
import {
  useSimWsDispatcher,
  type WsSubscribe,
  type SimErrorCode,
  type SimulationStatus,
} from './sim/useSimWsDispatcher'

// Re-export the public types so existing callers (DeviceChip, EtaBar,
// SimContext, App.tsx, etc.) keep importing from `'../hooks/useSimulation'`
// without churn.
export type { LatLng, DeviceRuntime, RuntimesMap, WsSubscribe, SimErrorCode, SimulationStatus }
export { emptyRuntime }

export enum SimMode {
  Teleport = 'teleport',
  Navigate = 'navigate',
  Loop = 'loop',
  Joystick = 'joystick',
  MultiStop = 'multistop',
  RandomWalk = 'randomwalk',
}

export enum MoveMode {
  Walking = 'walking',
  Running = 'running',
  Driving = 'driving',
}

/** SimMode → i18n label key mapping. */
export const MODE_LABEL_KEYS = {
  [SimMode.Teleport]: 'mode.teleport',
  [SimMode.Navigate]: 'mode.navigate',
  [SimMode.Loop]: 'mode.loop',
  [SimMode.MultiStop]: 'mode.multi_stop',
  [SimMode.RandomWalk]: 'mode.random_walk',
  [SimMode.Joystick]: 'mode.joystick',
} as const

/** Map backend state strings to SimMode. */
export function stateToMode(state: string): SimMode | null {
  switch (state) {
    case 'navigating': return SimMode.Navigate
    case 'looping': return SimMode.Loop
    case 'multi_stop': return SimMode.MultiStop
    case 'random_walk': return SimMode.RandomWalk
    case 'joystick': return SimMode.Joystick
    default: return null
  }
}

// ── Fan-out helper ─────────────────────────────────────────────────────
export interface FanoutOutcome<T> {
  ok: Array<{ udid: string; value: T }>
  failed: Array<{ udid: string; reason: string }>
}

export function summarizeResults<T>(
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

export interface UseSimulationOptions {
  /**
   * Optional code → localised string translator. Owned by the consumer
   * (SimContext has `useT`); the hook itself stays i18n-agnostic. When
   * omitted, the raw error code is stored — fine for tests / non-UI use.
   */
  translateError?: (code: SimErrorCode) => string
}

export function useSimulation(subscribe?: WsSubscribe, options?: UseSimulationOptions) {
  const translateError = options?.translateError
  // Latest translator in a ref so the WS subscribe effect can call it
  // without listing `translateError` in its deps (which would otherwise
  // tear down + rebuild the subscriber every time the i18n language flips).
  const translateErrorRef = useRef<((code: SimErrorCode) => string) | undefined>(translateError)
  useEffect(() => { translateErrorRef.current = translateError }, [translateError])

  const localizeError = useCallback((code: SimErrorCode): string => {
    const fn = translateErrorRef.current
    return fn ? fn(code) : code
  }, [])
  const [mode, _setMode] = useState<SimMode>(SimMode.Teleport)
  // Latest mode in a ref so optimistic action handlers can capture the
  // pre-call value cheaply (without re-creating their useCallback identity
  // on every mode change). Used by navigate/startLoop/multiStop/randomWalk/
  // joystickStart to roll back if the backend rejects the request.
  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])
  const [moveMode, setMoveMode] = useState<MoveMode>(MoveMode.Walking)
  const [status, setStatus] = useState<SimulationStatus>({
    running: false,
    paused: false,
    speed: 0,
  })
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null)
  // True once the backend engine is known to hold the same position the UI is
  // showing — i.e. a teleport/navigate/etc. has succeeded this session, an
  // initial `getStatus()` returned a live position, or a WS position_update
  // arrived. False immediately after startup when the pin is purely a
  // rehydrated cache from persisted settings (backend engine is idle to
  // preserve the phone's real GPS). The UI uses this flag to dim the cached
  // pin and to prompt before the first movement action.
  const [backendPositionSynced, setBackendPositionSynced] = useState(false)
  const [destination, setDestination] = useState<LatLng | null>(null)
  const [progress, setProgress] = useState(0)
  const [eta, setEta] = useState<number | null>(null)
  const [waypoints, setWaypoints] = useState<LatLng[]>([])
  const [routePath, setRoutePath] = useState<LatLng[]>([])
  const [customSpeedKmh, setCustomSpeedKmh] = useState<number | null>(null)
  const [speedMinKmh, setSpeedMinKmh] = useState<number | null>(null)
  const [speedMaxKmh, setSpeedMaxKmh] = useState<number | null>(null)
  // Global "straight-line path" toggle. When on, all nav modes bypass OSRM
  // and move along densified straight segments between waypoints.
  const [straightLine, setStraightLineRaw] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.straightLine) === '1' } catch { return false }
  })
  const setStraightLine = (v: boolean) => {
    setStraightLineRaw(v)
    try { localStorage.setItem(STORAGE_KEYS.straightLine, v ? '1' : '0') } catch { /* ignore */ }
  }

  // Per-mode pause settings, persisted in localStorage.
  interface PauseSetting { enabled: boolean; min: number; max: number }
  const defaultPause: PauseSetting = { enabled: true, min: 5, max: 20 }
  const loadPause = (key: string): PauseSetting => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return defaultPause
      const p = JSON.parse(raw)
      return {
        enabled: typeof p.enabled === 'boolean' ? p.enabled : true,
        min: typeof p.min === 'number' ? p.min : 5,
        max: typeof p.max === 'number' ? p.max : 20,
      }
    } catch {
      return defaultPause
    }
  }
  const savePause = (key: string, v: PauseSetting) => {
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
  }
  const [pauseMultiStop, setPauseMultiStopRaw] = useState<PauseSetting>(() => loadPause(STORAGE_KEYS.pauseMultiStop))
  const [pauseLoop, setPauseLoopRaw] = useState<PauseSetting>(() => loadPause(STORAGE_KEYS.pauseLoop))
  const [pauseRandomWalk, setPauseRandomWalkRaw] = useState<PauseSetting>(() => loadPause(STORAGE_KEYS.pauseRandomWalk))
  const setPauseMultiStop = (v: PauseSetting) => { setPauseMultiStopRaw(v); savePause(STORAGE_KEYS.pauseMultiStop, v) }
  const setPauseLoop = (v: PauseSetting) => { setPauseLoopRaw(v); savePause(STORAGE_KEYS.pauseLoop, v) }
  const setPauseRandomWalk = (v: PauseSetting) => { setPauseRandomWalkRaw(v); savePause(STORAGE_KEYS.pauseRandomWalk, v) }
  const [error, setError] = useState<string | null>(null)
  // Random-walk pause countdown (unix epoch seconds of when pause ends)
  const [pauseEndAt, setPauseEndAt] = useState<number | null>(null)
  const [pauseRemaining, setPauseRemaining] = useState<number | null>(null)
  const [ddiMounting, setDdiMounting] = useState(false)
  // One-shot signal consumed by SimContext's toast observer. `ts`
  // deduplicates repeats of the same failure across re-renders.
  const [ddiMissing, setDdiMissing] = useState<
    { reason: string; stage?: string; ts: number } | null
  >(null)
  const [waypointProgress, setWaypointProgress] = useState<{ current: number; next: number; total: number } | null>(null)
  // Loop / MultiStop target lap count. null = unlimited (existing
  // behaviour). Positive = backend will auto-stop after N laps.
  const [loopLapCount, setLoopLapCount] = useState<number | null>(null)
  // Progress readout from the `lap_complete` WS event. total is the
  // target (when set) so the UI can render "3 / 5" style.
  const [lapProgress, setLapProgress] = useState<{ current: number; total: number | null } | null>(null)
  // What's *actually* running on the device — set when a route handler
  // starts or when applySpeed succeeds. Used by the status bar so the user
  // doesn't see the typed-but-unapplied speed before pressing Apply.
  const [effectiveSpeed, setEffectiveSpeed] = useState<
    { mode: MoveMode; kmh: number | null; min: number | null; max: number | null } | null
  >(null)

  // Per-device runtime map (group mode). Populated from WS events tagged
  // with udid via the dispatcher hook below.
  const { runtimes, setRuntimes, updateRuntime } = useSimRuntimes()

  // Tick the pause countdown at 1 Hz
  useEffect(() => {
    if (pauseEndAt == null) {
      setPauseRemaining(null)
      return
    }
    const tick = () => {
      const rem = Math.max(0, Math.round((pauseEndAt - Date.now()) / 1000))
      setPauseRemaining(rem)
      if (rem <= 0) setPauseEndAt(null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [pauseEndAt])

  // Wire incoming WS messages into the legacy single-device state and the
  // per-device runtimes map. The dispatcher itself owns no state — it just
  // routes events to the setters bundled below. The bundle is rebuilt
  // each render but the dispatcher captures it via a ref so its subscribe
  // effect doesn't tear down on every parent re-render.
  //
  // setMode: dispatcher passes a backend-side string (lowercase mode name)
  // through; cast to SimMode here since the enum values match the strings.
  useSimWsDispatcher(subscribe, {
    setRuntimes,
    updateRuntime,
    setCurrentPosition,
    setBackendPositionSynced,
    setProgress,
    setEta,
    setStatus,
    setMode: (next) => _setMode(next as SimMode),
    setDestination,
    setWaypoints,
    setRoutePath,
    setPauseEndAt,
    setWaypointProgress,
    setLapProgress,
    setDdiMounting,
    setDdiMissing,
    setError,
    localizeError,
  })

  const clearError = useCallback(() => setError(null), [])

  // Public mode setter: clears the destination marker + route path when the
  // user switches mode tabs. Internal handlers (teleport/navigate/loop/...)
  // still use _setMode directly so they can set destination in the same tick.
  const setMode = useCallback((next: SimMode) => {
    _setMode((prev) => {
      if (prev !== next) {
        setDestination(null)
        setRoutePath([])
        setWaypoints([])
        setProgress(0)
        setEta(null)
      }
      return next
    })
  }, [])

  const teleport = useCallback(async (lat: number, lng: number) => {
    // Mode is owned by the user's explicit tab choice; the backend
    // stops any active simulation atomically on teleport, so we don't
    // touch mode here — quick-fly actions (bookmark click, search,
    // TeleportPanel "Go") keep the current Loop / MultiStop / Navigate.
    setError(null)
    const res = await api.teleport(lat, lng)
    setCurrentPosition({ lat, lng })
    setBackendPositionSynced(true)
    setDestination(null)
    setProgress(0)
    setEta(null)
    return res
  }, [])

  const navigate = useCallback(
    async (lat: number, lng: number) => {
      setError(null)
      // Capture pre-call state for rollback on backend rejection. Without
      // this the tab UI stays on "Navigate" with a destination pin while
      // the engine is actually idle.
      const prevMode = modeRef.current
      _setMode(SimMode.Navigate)
      setDestination({ lat, lng })
      setProgress(0)
      try {
        const res = await api.navigate(lat, lng, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, undefined, straightLine)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err) {
        _setMode(prevMode)
        setDestination(null)
        throw err
      }
    },
    // navigate body doesn't read pauseMultiStop / pauseLoop / pauseRandomWalk —
    // dropping them so this callback identity doesn't churn on unrelated edits.
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, straightLine],
  )

  const startLoop = useCallback(
    async (wps: LatLng[]) => {
      setError(null)
      const prevMode = modeRef.current
      _setMode(SimMode.Loop)
      // Don't setWaypoints(wps) — wps is the route as sent to the backend
      // (already includes the start position from caller). Overwriting UI
      // waypoints here would prepend the start point on every restart,
      // and break the backend↔UI seg_idx mapping for highlighting.
      setProgress(0)
      setLapProgress(loopLapCount != null ? { current: 0, total: loopLapCount } : null)
      try {
        const res = await api.startLoop(wps, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseLoop.enabled, pause_min: pauseLoop.min, pause_max: pauseLoop.max }, undefined, straightLine, loopLapCount)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err) {
        _setMode(prevMode)
        setLapProgress(null)
        throw err
      }
    },
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, pauseLoop, pauseRandomWalk, straightLine, loopLapCount],
  )

  const multiStop = useCallback(
    async (wps: LatLng[], stopDuration: number, loop: boolean) => {
      setError(null)
      const prevMode = modeRef.current
      _setMode(SimMode.MultiStop)
      // See startLoop — do not overwrite UI waypoints with the backend route.
      setProgress(0)
      setLapProgress(loop && loopLapCount != null ? { current: 0, total: loopLapCount } : null)
      try {
        const res = await api.multiStop(wps, moveMode, stopDuration, loop, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseMultiStop.enabled, pause_min: pauseMultiStop.min, pause_max: pauseMultiStop.max }, undefined, straightLine, loop ? loopLapCount : null)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err) {
        _setMode(prevMode)
        setLapProgress(null)
        throw err
      }
    },
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, pauseLoop, pauseRandomWalk, straightLine, loopLapCount],
  )

  const randomWalk = useCallback(
    async (center: LatLng, radiusM: number) => {
      setError(null)
      const prevMode = modeRef.current
      _setMode(SimMode.RandomWalk)
      setProgress(0)
      try {
        const res = await api.randomWalk(center, radiusM, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseRandomWalk.enabled, pause_min: pauseRandomWalk.min, pause_max: pauseRandomWalk.max }, undefined, undefined, straightLine)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err) {
        _setMode(prevMode)
        throw err
      }
    },
    // Body uses only pauseRandomWalk — drop the other two pause settings.
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseRandomWalk, straightLine],
  )

  const joystickStart = useCallback(async () => {
    setError(null)
    const prevMode = modeRef.current
    _setMode(SimMode.Joystick)
    try {
      const res = await api.joystickStart(moveMode)
      setStatus((prev) => ({ ...prev, running: true, paused: false }))
      return res
    } catch (err) {
      _setMode(prevMode)
      throw err
    }
  }, [moveMode])

  const joystickStop = useCallback(async () => {
    setError(null)
    const res = await api.joystickStop()
    // leave mode as-is; status drives running state
    setStatus((prev) => ({ ...prev, running: false, paused: false }))
    return res
  }, [])

  const pause = useCallback(async () => {
    setError(null)
    const res = await api.pauseSim()
    setStatus((prev) => ({ ...prev, paused: true }))
    return res
  }, [])

  const resume = useCallback(async () => {
    setError(null)
    const res = await api.resumeSim()
    setStatus((prev) => ({ ...prev, paused: false }))
    return res
  }, [])

  const stop = useCallback(async () => {
    setError(null)
    const res = await api.stopSim()
    setStatus((prev) => ({ ...prev, running: false, paused: false }))
    setProgress(0)
    setEta(null)
    setRoutePath([])
    setWaypointProgress(null)
    // Clear the lap progress counter too — otherwise a stopped run
    // keeps showing "3 / 5" in the Loop / MultiStop panel until the
    // next `simulation_complete` WS event (which never arrives on a
    // manual Stop in some edge cases).
    setLapProgress(null)
    setEffectiveSpeed(null)
    // Clear the destination so the red "target" marker goes away —
    // lingering destination pin after Stop was a reported UX bug.
    setDestination(null)
    return res
  }, [])

  const restore = useCallback(async () => {
    setError(null)
    const res = await api.restoreSim()
    // leave mode as-is; status drives running state
    setStatus({ running: false, paused: false, speed: 0 })
    setCurrentPosition(null)
    setBackendPositionSynced(false)
    setDestination(null)
    setProgress(0)
    setEta(null)
    setWaypoints([])
    setRoutePath([])
    setWaypointProgress(null)
    setLapProgress(null)
    setEffectiveSpeed(null)
    return res
  }, [])

  const applySpeed = useCallback(async () => {
    setError(null)
    const res = await api.applySpeed(moveMode, {
      speed_kmh: customSpeedKmh,
      speed_min_kmh: speedMinKmh,
      speed_max_kmh: speedMaxKmh,
    })
    // Status bar should now reflect the just-applied values, not the
    // ones the route originally started with.
    setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
    return res
  }, [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh])

  // Fetch initial status on mount
  const initialFetched = useRef(false)
  useEffect(() => {
    if (initialFetched.current) return
    initialFetched.current = true
    api.getStatus().then((res) => {
      let hadLivePosition = false
      if (res.position) {
        hadLivePosition = true
        setCurrentPosition({ lat: res.position.lat, lng: res.position.lng })
        setBackendPositionSynced(true)
      }
      if (res.mode) {
        const mapped = stateToMode(res.mode)
        if (mapped) _setMode(mapped)
      }
      if (res.running != null || res.paused != null) {
        setStatus({
          running: !!res.running,
          paused: !!res.paused,
          speed: res.speed ?? 0,
        })
      }
      // Fallback: on a fresh server restart the engine is intentionally
      // left idle (no position pushed to the iPhone). Rehydrate the last
      // known position from persisted settings so the pin shows up
      // immediately instead of the empty "尚未取得目前位置" state. A real
      // position_update from the device supersedes this automatically.
      if (!hadLivePosition) {
        api.getLastDevicePosition().then(({ position }) => {
          if (position) {
            setCurrentPosition((prev) => prev ?? { lat: position.lat, lng: position.lng })
          }
        }).catch(() => { /* ignore — just start empty */ })
      }
    }).catch(() => {
      // backend may not be running yet
    })
  }, [])

  // ── Group-mode fan-out helpers ──────────────────────────────────────
  // Each takes an explicit list of udids so the caller (App.tsx) decides
  // which devices to target. Returns a FanoutOutcome for toast summarisation.
  const fanout = useCallback(async <T,>(
    udids: string[],
    action: string,
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
    if (import.meta.env.DEV) {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          // eslint-disable-next-line no-console
          console.warn(
            '[preSyncStart] teleport failed for',
            udids[i],
            r.reason,
          )
        }
      })
    }
    // Tiny settle delay so devices finalise the teleport before the next
    // command arrives.
    await new Promise((r) => setTimeout(r, PRE_SYNC_SETTLE_MS))
  }, [currentPosition])

  const teleportAll = useCallback((udids: string[], lat: number, lng: number) =>
    fanout(udids, 'teleport', (u) => api.teleport(lat, lng, u)), [fanout])
  const navigateAll = useCallback(async (udids: string[], lat: number, lng: number) => {
    await preSyncStart(udids)
    return fanout(udids, 'navigate', (u) => api.navigate(lat, lng, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, u, straightLine))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, straightLine])
  const startLoopAll = useCallback(async (udids: string[], wps: LatLng[]) => {
    await preSyncStart(udids)
    setLapProgress(loopLapCount != null ? { current: 0, total: loopLapCount } : null)
    return fanout(udids, 'loop', (u) => api.startLoop(wps, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseLoop.enabled, pause_min: pauseLoop.min, pause_max: pauseLoop.max }, u, straightLine, loopLapCount))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseLoop, straightLine, loopLapCount])
  const multiStopAll = useCallback(async (udids: string[], wps: LatLng[], dur: number, loop: boolean) => {
    await preSyncStart(udids)
    setLapProgress(loop && loopLapCount != null ? { current: 0, total: loopLapCount } : null)
    return fanout(udids, 'multistop', (u) => api.multiStop(wps, moveMode, dur, loop, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseMultiStop.enabled, pause_min: pauseMultiStop.min, pause_max: pauseMultiStop.max }, u, straightLine, loop ? loopLapCount : null))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, straightLine, loopLapCount])
  const randomWalkAll = useCallback(async (udids: string[], center: LatLng, r: number) => {
    await preSyncStart(udids)
    // Shared seed → both engines produce identical destination sequences.
    const seed = udids.length >= 2 ? Date.now() : null
    return fanout(udids, 'randomwalk', (u) => api.randomWalk(center, r, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseRandomWalk.enabled, pause_min: pauseRandomWalk.min, pause_max: pauseRandomWalk.max }, u, seed, straightLine))
  }, [fanout, preSyncStart, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseRandomWalk, straightLine])
  const applySpeedAll = useCallback((udids: string[]) =>
    fanout(udids, 'apply-speed', (u) => api.applySpeed(moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, u)),
    [fanout, moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh])
  const pauseAll = useCallback((udids: string[]) => fanout(udids, 'pause', (u) => api.pauseSim(u)), [fanout])
  const resumeAll = useCallback((udids: string[]) => fanout(udids, 'resume', (u) => api.resumeSim(u)), [fanout])
  const stopAll = useCallback((udids: string[]) => fanout(udids, 'stop', (u) => api.stopSim(u)), [fanout])
  const restoreAll = useCallback(async (udids: string[]) => {
    const outcome = await fanout(udids, 'restore', (u) => api.restoreSim(u))
    // Clear per-device runtime state (markers, routes) and legacy state so
    // the map immediately reflects the wipe without waiting for events.
    setRuntimes((prev) => {
      const next: RuntimesMap = { ...prev }
      for (const u of udids) {
        if (next[u]) {
          next[u] = { ...next[u], currentPos: null, destination: null, routePath: [], progress: 0, eta: 0, distanceRemaining: 0, distanceTraveled: 0, waypointIndex: null, state: 'idle' }
        }
      }
      return next
    })
    setCurrentPosition(null)
    setDestination(null)
    setProgress(0)
    setEta(null)
    setWaypoints([])
    setRoutePath([])
    setWaypointProgress(null)
    setLapProgress(null)
    setEffectiveSpeed(null)
    return outcome
  }, [fanout])
  const joystickStartAll = useCallback(async (udids: string[]) => {
    await preSyncStart(udids)
    return fanout(udids, 'joystick-start', (u) => api.joystickStart(moveMode, u))
  }, [fanout, preSyncStart, moveMode])
  const joystickStopAll = useCallback((udids: string[]) =>
    fanout(udids, 'joystick-stop', (u) => api.joystickStop(u)), [fanout])

  // Derived: primary runtime for legacy single-device components.
  const primaryRuntime: DeviceRuntime | null = (() => {
    const keys = Object.keys(runtimes)
    return keys.length ? runtimes[keys[0]] : null
  })()
  const anyRunning = Object.values(runtimes).some((r) =>
    r.state && r.state !== 'idle' && r.state !== 'disconnected',
  )

  return {
    runtimes,
    primaryRuntime,
    anyRunning,
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
    mode,
    setMode,
    moveMode,
    setMoveMode,
    status,
    currentPosition,
    setCurrentPosition,
    backendPositionSynced,
    setBackendPositionSynced,
    destination,
    setDestination,
    progress,
    eta,
    waypoints,
    setWaypoints,
    routePath,
    customSpeedKmh,
    setCustomSpeedKmh,
    speedMinKmh,
    setSpeedMinKmh,
    speedMaxKmh,
    setSpeedMaxKmh,
    straightLine,
    setStraightLine,
    pauseMultiStop,
    setPauseMultiStop,
    pauseLoop,
    setPauseLoop,
    pauseRandomWalk,
    setPauseRandomWalk,
    pauseRemaining,
    ddiMounting,
    ddiMissing,
    waypointProgress,
    loopLapCount,
    setLoopLapCount,
    lapProgress,
    effectiveSpeed,
    applySpeed,
    error,
    clearError,
    teleport,
    stop,
    navigate,
    startLoop,
    multiStop,
    randomWalk,
    joystickStart,
    joystickStop,
    pause,
    resume,
    restore,
  }
}
