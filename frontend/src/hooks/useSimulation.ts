import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import * as api from '../services/api'
import { PRE_SYNC_SETTLE_MS } from '../lib/constants'
import { STORAGE_KEYS } from '../lib/storage-keys'
import { devWarn } from '../lib/dev-log'
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
import {
  usePauseSettings,
  useStraightLineToggle,
  type PauseSetting,
} from './sim/usePauseSettings'

// Re-export the public types so existing callers (DeviceChip, EtaBar,
// SimContext, App.tsx, etc.) keep importing from `'../hooks/useSimulation'`
// without churn.
export type { LatLng, DeviceRuntime, RuntimesMap, WsSubscribe, SimErrorCode, SimulationStatus, PauseSetting }
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

// ── Speed preference persistence ───────────────────────────────────────
// The user's last-selected movement speed (mode + any manual override)
// is persisted so a relaunch reuses it instead of resetting to Walking.
// Pure module-level helpers keep the localStorage shape in one place and
// avoid a circular import (MoveMode lives in this module).
interface SpeedPrefs {
  moveMode: MoveMode
  customSpeedKmh: number | null
  speedMinKmh: number | null
  speedMaxKmh: number | null
}

// Explicit speed selection used to hot-swap a running route's speed without
// reading hook state. Passing the values explicitly (rather than relying on
// the `applySpeed` closure) avoids a stale-closure bug: a caller that does
// `setMoveMode(x)` then `applySpeed()` in the same tick would otherwise send
// the *previous* moveMode, because the state update hasn't re-rendered yet.
export type SpeedSelection = SpeedPrefs

const DEFAULT_SPEED_PREFS: SpeedPrefs = {
  moveMode: MoveMode.Walking,
  customSpeedKmh: null,
  speedMinKmh: null,
  speedMaxKmh: null,
}

function isMoveMode(v: unknown): v is MoveMode {
  return v === MoveMode.Walking || v === MoveMode.Running || v === MoveMode.Driving
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function loadSpeedPrefs(): SpeedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.speedPrefs)
    if (!raw) return DEFAULT_SPEED_PREFS
    const p = JSON.parse(raw) as Record<string, unknown>
    return {
      moveMode: isMoveMode(p.moveMode) ? p.moveMode : DEFAULT_SPEED_PREFS.moveMode,
      customSpeedKmh: numOrNull(p.customSpeedKmh),
      speedMinKmh: numOrNull(p.speedMinKmh),
      speedMaxKmh: numOrNull(p.speedMaxKmh),
    }
  } catch {
    return DEFAULT_SPEED_PREFS
  }
}

function saveSpeedPrefs(p: SpeedPrefs): void {
  try { localStorage.setItem(STORAGE_KEYS.speedPrefs, JSON.stringify(p)) } catch { /* ignore */ }
}

/** Map backend state strings to SimMode. */
function stateToMode(state: string): SimMode | null {
  switch (state) {
    case 'navigating': return SimMode.Navigate
    case 'looping': return SimMode.Loop
    case 'multi_stop': return SimMode.MultiStop
    case 'random_walk': return SimMode.RandomWalk
    case 'joystick': return SimMode.Joystick
    default: return null
  }
}

/** Inverse of `stateToMode` — the engine state a mode runs in. Used for
 *  optimistic runtime patches (resume) where the backend state string
 *  isn't known yet. Teleport has no running state → null. */
function modeToState(mode: SimMode): string | null {
  switch (mode) {
    case SimMode.Navigate: return 'navigating'
    case SimMode.Loop: return 'looping'
    case SimMode.MultiStop: return 'multi_stop'
    case SimMode.RandomWalk: return 'random_walk'
    case SimMode.Joystick: return 'joystick'
    default: return null
  }
}

/** States in which the engine is actively simulating. `paused` counts as
 *  running — a paused run is still a run (the pause/resume pill stays). */
function isActiveState(state: string | undefined): boolean {
  return state != null && state !== 'idle' && state !== 'disconnected'
}

// Stable empty path so the derived `routePath` keeps referential identity
// across renders when no runtime exists yet.
const EMPTY_ROUTE_PATH: LatLng[] = []

// ── Fan-out helper ─────────────────────────────────────────────────────
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
  // Speed prefs lazy-load from localStorage so the last-selected speed is
  // reused on relaunch. A single one-shot read seeds all four fields below.
  // `useRef(loadSpeedPrefs())` would re-invoke the localStorage read on every
  // render (the arg is evaluated each time, even though useRef keeps the
  // first); a lazy state initialiser runs it exactly once.
  const [initialSpeedPrefs] = useState<SpeedPrefs>(loadSpeedPrefs)
  const [moveMode, setMoveMode] = useState<MoveMode>(initialSpeedPrefs.moveMode)
  // Engine speed multiplier reported by the initial `getStatus()` fetch.
  // Feeds the derived `status.speed` field (no consumer reads it today,
  // but the public SimulationStatus shape keeps it).
  const [statusSpeed, setStatusSpeed] = useState(0)
  // True once the backend engine is known to hold the same position the UI is
  // showing — i.e. a teleport/navigate/etc. has succeeded this session, an
  // initial `getStatus()` returned a live position, or a WS position_update
  // arrived. False immediately after startup when the pin is purely a
  // rehydrated cache from persisted settings (backend engine is idle to
  // preserve the phone's real GPS). The UI uses this flag to dim the cached
  // pin and to prompt before the first movement action.
  const [backendPositionSynced, setBackendPositionSynced] = useState(false)
  // User-input state: the destination marker (map clicks, search results)
  // and staged waypoints. These are NOT device state — they stay real
  // state here; the WS dispatcher only ever CLEARS destination.
  const [destination, setDestination] = useState<LatLng | null>(null)
  const [waypoints, setWaypoints] = useState<LatLng[]>([])
  const [customSpeedKmh, setCustomSpeedKmh] = useState<number | null>(initialSpeedPrefs.customSpeedKmh)
  const [speedMinKmh, setSpeedMinKmh] = useState<number | null>(initialSpeedPrefs.speedMinKmh)
  const [speedMaxKmh, setSpeedMaxKmh] = useState<number | null>(initialSpeedPrefs.speedMaxKmh)
  // Persist the speed selection whenever any of the four fields changes so
  // the next launch reuses it. Cheap JSON write; no throttle needed since
  // these change only on explicit user input, not on the 10 Hz nav stream.
  useEffect(() => {
    saveSpeedPrefs({ moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh })
  }, [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh])
  // Global "straight-line path" toggle. When on, all nav modes bypass OSRM
  // and move along densified straight segments between waypoints.
  const [straightLine, setStraightLine] = useStraightLineToggle()

  // Per-mode pause settings, persisted in localStorage. Default
  // {enabled: true, min: 5, max: 20} matches backend DEFAULT_PAUSE_*.
  const {
    pauseLoop, pauseMultiStop, pauseRandomWalk,
    setPauseLoop, setPauseMultiStop, setPauseRandomWalk,
  } = usePauseSettings()
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
  const [loopLapCount, setLoopLapCount] = useState<number | null>(1)
  // Progress readout from the `lap_complete` WS event. total is the
  // target (when set) so the UI can render "3 / 5" style.
  const [lapProgress, setLapProgress] = useState<{ current: number; total: number | null } | null>(null)
  // What's *actually* running on the device — set when a route handler
  // starts or when applySpeed succeeds. Used by the status bar so the user
  // doesn't see the typed-but-unapplied speed before pressing Apply.
  const [effectiveSpeed, setEffectiveSpeed] = useState<
    { mode: MoveMode; kmh: number | null; min: number | null; max: number | null } | null
  >(null)

  // Per-device runtime map — the single source of truth for device
  // simulation state. Populated from WS events via the dispatcher hook
  // below and patched optimistically by the action handlers here. The
  // single-device fields this hook returns (currentPosition, status,
  // progress, eta, routePath) are derived from the primary entry.
  const { runtimes, setRuntimes, updateRuntime, patchPrimaryRuntime } = useSimRuntimes()

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

  // Wire incoming WS messages into the runtimes map (per-device state)
  // and the session-global setters (overlays, DDI, error). The dispatcher
  // itself owns no state — it just routes events to the setters bundled
  // below. The bundle is rebuilt each render but the dispatcher captures
  // it via a ref so its subscribe effect doesn't tear down on every
  // parent re-render.
  useSimWsDispatcher(subscribe, {
    setRuntimes,
    updateRuntime,
    patchPrimaryRuntime,
    setBackendPositionSynced,
    setDestination,
    setPauseEndAt,
    setWaypointProgress,
    setLapProgress,
    setDdiMounting,
    setDdiMissing,
    setError,
    localizeError,
  })

  // Derived: primary runtime feeding the single-device view below.
  // Memoised so consumers see a stable reference between renders when
  // `runtimes` itself is unchanged — `Object.keys(runtimes)` allocates,
  // and re-allocating it every render churns downstream `useMemo` deps.
  const primaryRuntime: DeviceRuntime | null = useMemo(() => {
    const keys = Object.keys(runtimes)
    return keys.length ? runtimes[keys[0]] : null
  }, [runtimes])
  const anyRunning = Object.values(runtimes).some((r) => isActiveState(r.state))

  // ── Single-device view (derived from the primary runtime) ──────────
  // These keep the names and semantics the pre-refactor legacy state
  // exposed, but there is no separate write path any more: WS frames and
  // optimistic actions both patch `runtimes`, and the view falls out.
  const currentPosition = primaryRuntime?.currentPos ?? null
  const progress = primaryRuntime?.progress ?? 0
  const eta = primaryRuntime?.eta ?? null
  const routePath = primaryRuntime?.routePath ?? EMPTY_ROUTE_PATH
  const status: SimulationStatus = useMemo(() => ({
    running: isActiveState(primaryRuntime?.state),
    paused: primaryRuntime?.state === 'paused',
    speed: statusSpeed,
    state: primaryRuntime?.state,
    ...(primaryRuntime
      ? {
          distance_remaining: primaryRuntime.distanceRemaining,
          distance_traveled: primaryRuntime.distanceTraveled,
        }
      : {}),
  }), [primaryRuntime, statusSpeed])

  // Imperative position setter kept for optimistic writers outside this
  // hook (SimContext's multi-device teleport). Routes through the same
  // runtimes write path as everything else.
  const setCurrentPosition = useCallback((pos: LatLng | null) => {
    patchPrimaryRuntime({ currentPos: pos })
  }, [patchPrimaryRuntime])

  const clearError = useCallback(() => setError(null), [])

  // Public mode setter: clears the destination marker + route path when the
  // user switches mode tabs. Internal handlers (teleport/navigate/loop/...)
  // still use _setMode directly so they can set destination in the same tick.
  const setMode = useCallback((next: SimMode) => {
    _setMode((prev) => {
      if (prev !== next) {
        setDestination(null)
        setWaypoints([])
        patchPrimaryRuntime({ routePath: [], progress: 0, eta: null })
      }
      return next
    })
  }, [patchPrimaryRuntime])

  const teleport = useCallback(async (lat: number, lng: number, autoJitter?: boolean) => {
    // Mode is owned by the user's explicit tab choice; the backend
    // stops any active simulation atomically on teleport, so we don't
    // touch mode here — quick-fly actions (bookmark click, search,
    // TeleportPanel "Go") keep the current Loop / MultiStop / Navigate.
    setError(null)
    const res = await api.teleport(lat, lng, undefined, autoJitter)
    patchPrimaryRuntime({ currentPos: { lat, lng }, progress: 0, eta: null })
    setBackendPositionSynced(true)
    setDestination(null)
    return res
  }, [patchPrimaryRuntime])

  const navigate = useCallback(
    async (lat: number, lng: number) => {
      setError(null)
      // Capture pre-call state for rollback on backend rejection. Without
      // this the tab UI stays on "Navigate" with a destination pin while
      // the engine is actually idle.
      const prevMode = modeRef.current
      _setMode(SimMode.Navigate)
      setDestination({ lat, lng })
      patchPrimaryRuntime({ progress: 0 })
      try {
        const res = await api.navigate(lat, lng, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, undefined, straightLine)
        // Optimistic running flip: the derived status reads running=true
        // from the active state string; the authoritative `state_change`
        // lands moments later with the same value.
        patchPrimaryRuntime({ state: 'navigating' })
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
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, straightLine, patchPrimaryRuntime],
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
      patchPrimaryRuntime({ progress: 0 })
      setLapProgress(loopLapCount != null ? { current: 0, total: loopLapCount } : null)
      try {
        const res = await api.startLoop(wps, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseLoop.enabled, pause_min: pauseLoop.min, pause_max: pauseLoop.max }, undefined, straightLine, loopLapCount)
        patchPrimaryRuntime({ state: 'looping' })
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err) {
        _setMode(prevMode)
        setLapProgress(null)
        throw err
      }
    },
    // Body reads only pauseLoop — keep deps tight so this callback identity
    // doesn't churn on unrelated pauseMultiStop / pauseRandomWalk edits.
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseLoop, straightLine, loopLapCount, patchPrimaryRuntime],
  )

  const multiStop = useCallback(
    async (wps: LatLng[], stopDuration: number, loop: boolean) => {
      setError(null)
      const prevMode = modeRef.current
      _setMode(SimMode.MultiStop)
      // See startLoop — do not overwrite UI waypoints with the backend route.
      patchPrimaryRuntime({ progress: 0 })
      setLapProgress(loop && loopLapCount != null ? { current: 0, total: loopLapCount } : null)
      try {
        const res = await api.multiStop(wps, moveMode, stopDuration, loop, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseMultiStop.enabled, pause_min: pauseMultiStop.min, pause_max: pauseMultiStop.max }, undefined, straightLine, loop ? loopLapCount : null)
        patchPrimaryRuntime({ state: 'multi_stop' })
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err) {
        _setMode(prevMode)
        setLapProgress(null)
        throw err
      }
    },
    // Body reads only pauseMultiStop — mirror of startLoop above.
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, straightLine, loopLapCount, patchPrimaryRuntime],
  )

  const randomWalk = useCallback(
    async (center: LatLng, radiusM: number) => {
      setError(null)
      const prevMode = modeRef.current
      _setMode(SimMode.RandomWalk)
      patchPrimaryRuntime({ progress: 0 })
      try {
        const res = await api.randomWalk(center, radiusM, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseRandomWalk.enabled, pause_min: pauseRandomWalk.min, pause_max: pauseRandomWalk.max }, undefined, undefined, straightLine)
        patchPrimaryRuntime({ state: 'random_walk' })
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err) {
        _setMode(prevMode)
        throw err
      }
    },
    // Body uses only pauseRandomWalk — drop the other two pause settings.
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseRandomWalk, straightLine, patchPrimaryRuntime],
  )

  const joystickStart = useCallback(async () => {
    setError(null)
    const prevMode = modeRef.current
    _setMode(SimMode.Joystick)
    try {
      const res = await api.joystickStart(moveMode)
      patchPrimaryRuntime({ state: 'joystick' })
      return res
    } catch (err) {
      _setMode(prevMode)
      throw err
    }
  }, [moveMode, patchPrimaryRuntime])

  const joystickStop = useCallback(async () => {
    setError(null)
    const res = await api.joystickStop()
    // leave mode as-is; the derived status drives running state
    patchPrimaryRuntime({ state: 'idle' })
    return res
  }, [patchPrimaryRuntime])

  const pause = useCallback(async () => {
    setError(null)
    const res = await api.pauseSim()
    patchPrimaryRuntime({ state: 'paused' })
    return res
  }, [patchPrimaryRuntime])

  const resume = useCallback(async () => {
    setError(null)
    const res = await api.resumeSim()
    // Optimistically return to the active mode's state string. When the
    // mode tab doesn't map to a running state (e.g. the user switched to
    // Teleport while paused), skip the patch — the backend's
    // `state_change` lands moments later with the real state.
    const resumedState = modeToState(modeRef.current)
    if (resumedState) patchPrimaryRuntime({ state: resumedState })
    return res
  }, [patchPrimaryRuntime])

  const stop = useCallback(async () => {
    setError(null)
    const res = await api.stopSim()
    patchPrimaryRuntime({ state: 'idle', progress: 0, eta: null, routePath: [] })
    setWaypointProgress(null)
    // Clear the lap progress counter too — otherwise a stopped run
    // keeps showing "3 / 5" in the Loop / MultiStop panel until the
    // next `multi_stop_complete` / `random_walk_complete` WS event
    // (which never arrives on a manual Stop in some edge cases).
    setLapProgress(null)
    setEffectiveSpeed(null)
    // Clear the destination so the red "target" marker goes away —
    // lingering destination pin after Stop was a reported UX bug.
    setDestination(null)
    return res
  }, [patchPrimaryRuntime])

  const restore = useCallback(async () => {
    setError(null)
    const res = await api.restoreSim()
    // leave mode as-is; the derived status drives running state
    patchPrimaryRuntime({
      state: 'idle',
      currentPos: null,
      destination: null,
      routePath: [],
      progress: 0,
      eta: null,
      distanceRemaining: 0,
      distanceTraveled: 0,
      waypointIndex: null,
    })
    setStatusSpeed(0)
    setBackendPositionSynced(false)
    setDestination(null)
    setWaypoints([])
    setWaypointProgress(null)
    setLapProgress(null)
    setEffectiveSpeed(null)
    return res
  }, [patchPrimaryRuntime])

  const applySpeed = useCallback(async (sel?: SpeedSelection) => {
    setError(null)
    // An explicit selection wins over hook state so a caller can switch speed
    // and apply it in the same tick (the dock SpeedToggle) without hitting the
    // stale closure. Falls back to current state for the panel's Apply button.
    const s = sel ?? { moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh }
    const res = await api.applySpeed(s.moveMode, {
      speed_kmh: s.customSpeedKmh,
      speed_min_kmh: s.speedMinKmh,
      speed_max_kmh: s.speedMaxKmh,
    })
    // Status bar should now reflect the just-applied values, not the
    // ones the route originally started with.
    setEffectiveSpeed({ mode: s.moveMode, kmh: s.customSpeedKmh, min: s.speedMinKmh, max: s.speedMaxKmh })
    return res
  }, [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh])

  // Fetch initial status on mount.
  //
  // Sequence (single async/await chain so failures and the secondary
  // last-position fetch share one top-level try/catch):
  //   1. getStatus() — primary source, also tells us whether the engine
  //      is currently pushing a live position.
  //   2. getLastDevicePosition() — fallback rehydration when the engine
  //      is idle on a fresh server restart. Skipped when (1) already
  //      delivered a live position.
  //
  // `aborted` guards every setState call so a late resolution after the
  // component unmounts is a no-op.
  //
  // Do NOT add a `useRef` "already fetched" guard here. Under dev StrictMode
  // (mount → unmount → mount) such a guard makes the FIRST mount claim the
  // one-shot, then its cleanup sets `aborted = true`, so when its fetch
  // resolves the setState is skipped — and the SECOND mount, seeing the guard
  // already set, never re-fetches. Net result: the persisted last position is
  // fetched but silently dropped, so the pin never appears on launch. Letting
  // the effect re-run per mount costs one extra read-only GET in dev (none in
  // prod) and the aborted first run is a harmless no-op.
  useEffect(() => {
    let aborted = false

    const run = async () => {
      // Issue both fetches in parallel: getStatus() is authoritative when
      // the engine is live; getLastDevicePosition() is the persisted
      // fallback used only when status has no live position. Sequential
      // awaits would cost an extra RTT on every cold mount even though
      // the fallback is almost always discarded.
      const [statusRes, lastPosRes] = await Promise.allSettled([
        api.getStatus(),
        api.getLastDevicePosition(),
      ])
      if (aborted) return

      let hadLivePosition = false
      if (statusRes.status === 'fulfilled') {
        const res = statusRes.value
        if (res.position) {
          hadLivePosition = true
          patchPrimaryRuntime({ currentPos: { lat: res.position.lat, lng: res.position.lng } })
          setBackendPositionSynced(true)
        }
        if (res.mode) {
          const mapped = stateToMode(res.mode)
          if (mapped) _setMode(mapped)
        }
        if (res.running != null || res.paused != null) {
          setStatusSpeed(res.speed ?? 0)
          // Seed the runtime state so the derived running/paused flags
          // match the engine snapshot. Lands in the local slot before the
          // first udid-tagged frame; the slot is promoted into the real
          // udid entry when that frame arrives.
          patchPrimaryRuntime({
            state: !res.running ? 'idle' : res.paused ? 'paused' : (res.mode ?? 'navigating'),
          })
        }
      }
      // Rehydrate from persisted settings only when the live engine has
      // no position (fresh server restart). A real position_update from
      // the device supersedes this immediately after.
      if (!hadLivePosition && lastPosRes.status === 'fulfilled') {
        const { position } = lastPosRes.value
        if (position) {
          // Functional patch: keep an already-set position (mirrors the
          // old `prev ?? value` updater).
          patchPrimaryRuntime((cur) =>
            cur.currentPos ? {} : { currentPos: { lat: position.lat, lng: position.lng } })
        }
      }
    }

    void run()

    return () => {
      aborted = true
    }
    // patchPrimaryRuntime is a stable useCallback — listing it keeps the
    // deps honest without re-running the mount fetch.
  }, [patchPrimaryRuntime])

  // ── Group-mode fan-out helpers ──────────────────────────────────────
  // Each takes an explicit list of udids so the caller (App.tsx) decides
  // which devices to target. Returns a FanoutOutcome for toast summarisation.
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
  const applySpeedAll = useCallback((udids: string[], sel?: SpeedSelection) => {
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
