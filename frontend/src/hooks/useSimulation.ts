import { useState, useCallback, useEffect, useRef } from 'react'
import * as api from '../services/api'
import { STORAGE_KEYS } from '../lib/storage-keys'
import type { WsMessage } from './useWebSocket'

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

export interface LatLng {
  lat: number
  lng: number
}

export interface SimulationStatus {
  running: boolean
  paused: boolean
  speed: number
  state?: string
  distance_remaining?: number
  distance_traveled?: number
}

export type WsSubscribe = (fn: (m: WsMessage) => void) => () => void

// ── Per-device runtime state (group mode) ──────────────────────────────
export interface DeviceRuntime {
  udid: string
  state: string
  currentPos: LatLng | null
  destination: LatLng | null
  routePath: LatLng[]
  progress: number
  eta: number
  distanceRemaining: number
  distanceTraveled: number
  waypointIndex: number | null
  currentSpeedKmh: number
  error: string | null
  lapCount: number
  cooldown: number
}

export type RuntimesMap = Record<string, DeviceRuntime>

function emptyRuntime(udid: string): DeviceRuntime {
  return {
    udid,
    state: 'idle',
    currentPos: null,
    destination: null,
    routePath: [],
    progress: 0,
    eta: 0,
    distanceRemaining: 0,
    distanceTraveled: 0,
    waypointIndex: null,
    currentSpeedKmh: 0,
    error: null,
    lapCount: 0,
    cooldown: 0,
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
  _action: string,
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

export function useSimulation(subscribe?: WsSubscribe) {
  const [mode, _setMode] = useState<SimMode>(SimMode.Teleport)
  const [moveMode, setMoveMode] = useState<MoveMode>(MoveMode.Walking)
  const [status, setStatus] = useState<SimulationStatus>({
    running: false,
    paused: false,
    speed: 0,
  })
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null)
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

  // Per-device runtime map (group mode). Populated from WS events tagged with udid.
  const [runtimes, setRuntimes] = useState<RuntimesMap>({})
  const updateRuntime = useCallback((udid: string, patch: Partial<DeviceRuntime>) => {
    setRuntimes((prev) => {
      const cur = prev[udid] ?? emptyRuntime(udid)
      return { ...prev, [udid]: { ...cur, ...patch } }
    })
  }, [])

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

  // Process incoming WS messages via subscribe callback. The old
  // useState-based approach dropped messages when two arrived in the
  // same React tick; see useWebSocket.ts for details.
  useEffect(() => {
    if (!subscribe) return
    return subscribe((wsMessage) => {
    // ── Group mode: mirror per-device state into `runtimes` map ────────
    const udid: string | undefined = wsMessage.data?.udid
    if (udid) {
      const d = wsMessage.data
      switch (wsMessage.type) {
        case 'position_update': {
          // Only include a key when the incoming payload carries it,
          // so a tick without `eta` doesn't wipe the cached value.
          const patch: Partial<DeviceRuntime> = {}
          if (typeof d.lat === 'number' && typeof d.lng === 'number') {
            patch.currentPos = { lat: d.lat, lng: d.lng }
          }
          if (d.progress != null) patch.progress = d.progress
          const etaVal = d.eta_seconds ?? d.eta
          if (etaVal != null) patch.eta = etaVal
          if (d.distance_remaining != null) patch.distanceRemaining = d.distance_remaining
          if (d.distance_traveled != null) patch.distanceTraveled = d.distance_traveled
          if (d.speed_mps != null) patch.currentSpeedKmh = d.speed_mps * 3.6
          if (Object.keys(patch).length > 0) updateRuntime(udid, patch)
          break
        }
        case 'route_path':
          if (Array.isArray(d.coords)) {
            updateRuntime(udid, {
              routePath: d.coords.map((p: any) => ({ lat: p.lat ?? p[0], lng: p.lng ?? p[1] })),
            })
          }
          break
        case 'state_change':
          if (d.state) updateRuntime(udid, { state: d.state, ...(d.state === 'idle' || d.state === 'disconnected' ? { routePath: [] } : {}) })
          break
        case 'device_connected':
          setRuntimes((prev) => prev[udid] ? prev : { ...prev, [udid]: emptyRuntime(udid) })
          // A device reconnecting implicitly resolves any prior connection-
          // loss banner (watchdog auto-connect now broadcasts `device_connected`
          // rather than `device_reconnected`; the legacy case still handles
          // the latter).
          setError(null)
          break
        case 'device_disconnected':
          updateRuntime(udid, { state: 'disconnected' })
          break
        case 'simulation_complete':
          updateRuntime(udid, { progress: 1, state: 'idle' })
          break
        case 'waypoint_progress':
          if (typeof d.current_index === 'number') {
            updateRuntime(udid, { waypointIndex: d.current_index })
          }
          break
      }
    }
    switch (wsMessage.type) {
      case 'position_update': {
        const { lat, lng } = wsMessage.data
        if (typeof lat === 'number' && typeof lng === 'number') {
          setCurrentPosition({ lat, lng })
        }
        if (wsMessage.data.progress != null) {
          setProgress(wsMessage.data.progress)
        }
        {
          const etaVal = wsMessage.data.eta_seconds ?? wsMessage.data.eta
          if (etaVal != null) setEta(etaVal)
        }
        {
          const dr = wsMessage.data.distance_remaining
          const dt = wsMessage.data.distance_traveled
          if (dr != null || dt != null) {
            setStatus((prev) => ({
              ...prev,
              ...(dr != null ? { distance_remaining: dr } : {}),
              ...(dt != null ? { distance_traveled: dt } : {}),
            }))
          }
        }
        break
      }
      case 'simulation_state': {
        const d = wsMessage.data
        setStatus({
          running: !!d.running,
          paused: !!d.paused,
          speed: d.speed ?? 0,
          state: d.state,
          distance_remaining: d.distance_remaining,
          distance_traveled: d.distance_traveled,
        })
        if (d.mode) _setMode(d.mode)
        if (d.progress != null) setProgress(d.progress)
        if (d.eta != null) setEta(d.eta)
        if (d.destination) setDestination(d.destination)
        if (d.waypoints) setWaypoints(d.waypoints)
        break
      }
      case 'simulation_complete': {
        setStatus((prev) => ({ ...prev, running: false, paused: false }))
        setProgress(1)
        setEta(null)
        setPauseEndAt(null)
        setWaypointProgress(null)
        setLapProgress(null)
        setDestination(null)
        setRoutePath([])
        break
      }
      case 'waypoint_progress': {
        const d = wsMessage.data
        if (d && typeof d.current_index === 'number') {
          setWaypointProgress({
            current: d.current_index,
            next: d.next_index ?? d.current_index + 1,
            total: d.total ?? 0,
          })
        }
        break
      }
      case 'lap_complete': {
        const d = wsMessage.data
        if (d && typeof d.lap === 'number') {
          setLapProgress({
            current: d.lap,
            total: typeof d.total === 'number' ? d.total : null,
          })
        }
        break
      }
      case 'ddi_mounting': {
        setDdiMounting(true)
        break
      }
      case 'ddi_mounted':
      case 'ddi_mount_failed': {
        setDdiMounting(false)
        break
      }
      case 'ddi_mount_missing': {
        // Auto-mount failed. The SimContext observer will surface a
        // single hint toast so the user knows what to do next.
        setDdiMounting(false)
        const d = wsMessage.data ?? {}
        setDdiMissing({
          reason: typeof d.reason === 'string' ? d.reason : 'unknown',
          stage: typeof d.stage === 'string' ? d.stage : undefined,
          ts: Date.now(),
        })
        break
      }
      case 'tunnel_lost': {
        // Uses localStorage to get current language (hooks don't have i18n context easily here)
        setError((typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.lang) === 'en')
          ? 'Wi-Fi tunnel dropped, please reconnect'
          : 'WiFi Tunnel 連線中斷,請重新建立')
        break
      }
      case 'device_disconnected': {
        const isEn = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.lang) === 'en'
        setError(isEn
          ? 'Device disconnected (USB unplugged or tunnel died), please reconnect USB'
          : '裝置連線中斷(USB 拔除或 Tunnel 死亡),請重新插上 USB')
        setStatus((prev) => ({ ...prev, running: false, paused: false }))
        break
      }
      case 'device_reconnected': {
        // Auto-reconnected by the usbmux watchdog after a re-plug, clear
        // the banner; the success is already visible via DeviceStatus.
        setError(null)
        break
      }
      case 'pause_countdown':
      case 'random_walk_pause': {
        const dur = wsMessage.data?.duration_seconds
        if (typeof dur === 'number' && dur > 0) {
          setPauseEndAt(Date.now() + dur * 1000)
        }
        break
      }
      case 'pause_countdown_end':
      case 'random_walk_pause_end': {
        setPauseEndAt(null)
        break
      }
      case 'route_path': {
        const pts = wsMessage.data?.coords
        if (Array.isArray(pts)) {
          setRoutePath(pts.map((p: any) => ({ lat: p.lat ?? p[0], lng: p.lng ?? p[1] })))
        }
        break
      }
      case 'state_change': {
        const st = wsMessage.data?.state
        if (st === 'idle' || st === 'disconnected') {
          setStatus((prev) => ({ ...prev, running: false, paused: false, state: st }))
          setRoutePath([])
          setDestination(null)
          setEta(null)
        } else if (st === 'paused') {
          setStatus((prev) => ({ ...prev, paused: true, state: st }))
        } else if (st) {
          setStatus((prev) => ({ ...prev, running: true, paused: false, state: st }))
        }
        break
      }
      case 'simulation_error': {
        setError(wsMessage.data?.message ?? 'Simulation error')
        break
      }
    }
    })
  }, [subscribe, updateRuntime])

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
    try {
      const res = await api.teleport(lat, lng)
      setCurrentPosition({ lat, lng })
      setDestination(null)
      setProgress(0)
      setEta(null)
      return res
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }, [])

  const navigate = useCallback(
    async (lat: number, lng: number) => {
      setError(null)
      try {
        _setMode(SimMode.Navigate)
        setDestination({ lat, lng })
        setProgress(0)
        const res = await api.navigate(lat, lng, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, undefined, straightLine)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err: any) {
        setError(err.message)
        throw err
      }
    },
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, pauseLoop, pauseRandomWalk, straightLine],
  )

  const startLoop = useCallback(
    async (wps: LatLng[]) => {
      setError(null)
      try {
        _setMode(SimMode.Loop)
        // Don't setWaypoints(wps) — wps is the route as sent to the backend
        // (already includes the start position from caller). Overwriting UI
        // waypoints here would prepend the start point on every restart,
        // and break the backend↔UI seg_idx mapping for highlighting.
        setProgress(0)
        setLapProgress(loopLapCount != null ? { current: 0, total: loopLapCount } : null)
        const res = await api.startLoop(wps, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseLoop.enabled, pause_min: pauseLoop.min, pause_max: pauseLoop.max }, undefined, straightLine, loopLapCount)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err: any) {
        setError(err.message)
        throw err
      }
    },
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, pauseLoop, pauseRandomWalk, straightLine, loopLapCount],
  )

  const multiStop = useCallback(
    async (wps: LatLng[], stopDuration: number, loop: boolean) => {
      setError(null)
      try {
        _setMode(SimMode.MultiStop)
        // See startLoop — do not overwrite UI waypoints with the backend route.
        setProgress(0)
        setLapProgress(loop && loopLapCount != null ? { current: 0, total: loopLapCount } : null)
        const res = await api.multiStop(wps, moveMode, stopDuration, loop, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseMultiStop.enabled, pause_min: pauseMultiStop.min, pause_max: pauseMultiStop.max }, undefined, straightLine, loop ? loopLapCount : null)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err: any) {
        setError(err.message)
        throw err
      }
    },
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, pauseLoop, pauseRandomWalk, straightLine, loopLapCount],
  )

  const randomWalk = useCallback(
    async (center: LatLng, radiusM: number) => {
      setError(null)
      try {
        _setMode(SimMode.RandomWalk)
        setProgress(0)
        const res = await api.randomWalk(center, radiusM, moveMode, { speed_kmh: customSpeedKmh, speed_min_kmh: speedMinKmh, speed_max_kmh: speedMaxKmh }, { pause_enabled: pauseRandomWalk.enabled, pause_min: pauseRandomWalk.min, pause_max: pauseRandomWalk.max }, undefined, undefined, straightLine)
        setStatus((prev) => ({ ...prev, running: true, paused: false }))
        setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
        return res
      } catch (err: any) {
        setError(err.message)
        throw err
      }
    },
    [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh, pauseMultiStop, pauseLoop, pauseRandomWalk, straightLine],
  )

  const joystickStart = useCallback(async () => {
    setError(null)
    try {
      _setMode(SimMode.Joystick)
      const res = await api.joystickStart(moveMode)
      setStatus((prev) => ({ ...prev, running: true, paused: false }))
      return res
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }, [moveMode])

  const joystickStop = useCallback(async () => {
    setError(null)
    try {
      const res = await api.joystickStop()
      // leave mode as-is; status drives running state
      setStatus((prev) => ({ ...prev, running: false, paused: false }))
      return res
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }, [])

  const pause = useCallback(async () => {
    setError(null)
    try {
      const res = await api.pauseSim()
      setStatus((prev) => ({ ...prev, paused: true }))
      return res
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }, [])

  const resume = useCallback(async () => {
    setError(null)
    try {
      const res = await api.resumeSim()
      setStatus((prev) => ({ ...prev, paused: false }))
      return res
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }, [])

  const stop = useCallback(async () => {
    setError(null)
    try {
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
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }, [])

  const restore = useCallback(async () => {
    setError(null)
    try {
      const res = await api.restoreSim()
      // leave mode as-is; status drives running state
      setStatus({ running: false, paused: false, speed: 0 })
      setCurrentPosition(null)
      setDestination(null)
      setProgress(0)
      setEta(null)
      setWaypoints([])
      setRoutePath([])
      setWaypointProgress(null)
      setLapProgress(null)
      setEffectiveSpeed(null)
      return res
    } catch (err: any) {
      setError(err.message)
      throw err
    }
  }, [])

  const applySpeed = useCallback(async () => {
    setError(null)
    try {
      const res = await api.applySpeed(moveMode, {
        speed_kmh: customSpeedKmh,
        speed_min_kmh: speedMinKmh,
        speed_max_kmh: speedMaxKmh,
      })
      // Status bar should now reflect the just-applied values, not the
      // ones the route originally started with.
      setEffectiveSpeed({ mode: moveMode, kmh: customSpeedKmh, min: speedMinKmh, max: speedMaxKmh })
      return res
    } catch (err: any) {
      setError(err.message)
      throw err
    }
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
    if (udids.length === 0) {
      setError('No device connected')
      return { ok: [], failed: [] }
    }
    const results = await Promise.allSettled(udids.map((u) => fn(u)))
    return summarizeResults(results, udids, action)
  }, [])

  // Group-mode sync helper: before any action that depends on a common start
  // (navigate / loop / multistop / randomwalk / joystick), teleport every
  // target device to the primary's current position so both phones begin from
  // the same coordinate and follow identical paths.
  const preSyncStart = useCallback(async (udids: string[]) => {
    if (udids.length < 2) return
    const pos = currentPosition
    if (!pos) return
    try {
      await Promise.allSettled(udids.map((u) => api.teleport(pos.lat, pos.lng, u)))
      // Tiny settle delay so devices finalise the teleport before the next
      // command arrives.
      await new Promise((r) => setTimeout(r, 150))
    } catch {
      // Non-fatal: fall through to the primary action.
    }
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
