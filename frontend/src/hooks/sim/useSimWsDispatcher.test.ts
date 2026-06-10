// @vitest-environment jsdom
/**
 * CHARACTERIZATION tests for useSimWsDispatcher.
 *
 * These pin the CURRENT dual-write behavior exactly: every WS frame is
 * routed into (1) the per-device `runtimes` map and (2) the legacy
 * single-device state. A later refactor will delete the legacy branch
 * against these tests, so both surfaces — including their asymmetries —
 * are asserted verbatim. Do not "fix" surprising expectations here;
 * they are the spec.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { SetStateAction } from 'react'
import { useSimWsDispatcher } from './useSimWsDispatcher'
import type { SimWsSetters, SimulationStatus, WsSubscribe } from './useSimWsDispatcher'
import type { DeviceRuntime, RuntimesMap } from './useSimRuntimes'
import { emptyRuntime } from './useSimRuntimes'
import type { LatLng } from './types'
import type { WsMessage } from '../useWebSocket'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ── Harness ────────────────────────────────────────────────────────────

const UDID_A = 'udid-A'
const UDID_B = 'udid-B'

interface HarnessState {
  runtimes: RuntimesMap
  currentPosition: LatLng | null
  backendPositionSynced: boolean
  progress: number
  eta: number | null
  status: SimulationStatus
  mode: string
  destination: LatLng | null
  waypoints: LatLng[]
  routePath: LatLng[]
  pauseEndAt: number | null
  waypointProgress: { current: number; next: number; total: number } | null
  lapProgress: { current: number; total: number | null } | null
  ddiMounting: boolean
  ddiMissing: { reason: string; stage?: string; ts: number } | null
  error: string | null
}

function initialState(): HarnessState {
  return {
    runtimes: {},
    currentPosition: null,
    backendPositionSynced: false,
    progress: 0,
    eta: null,
    status: { running: false, paused: false, speed: 1 },
    mode: 'navigation',
    destination: null,
    waypoints: [],
    routePath: [],
    pauseEndAt: null,
    waypointProgress: null,
    lapProgress: null,
    ddiMounting: false,
    ddiMissing: null,
    error: null,
  }
}

function resolveAction<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === 'function' ? (action as (p: T) => T)(prev) : action
}

interface Harness {
  state: HarnessState
  setters: SimWsSetters
  send: (type: string, data: unknown) => void
  unmount: () => void
  subscribe: WsSubscribe
  unsubscribe: () => void
  /** Setter mocks keyed by name, for "which setters fired" assertions. */
  mocks: Record<string, { mock: { calls: unknown[][] } }>
}

function createHarness(seed?: Partial<HarnessState>): Harness {
  const state: HarnessState = { ...initialState(), ...seed }

  const track = <T,>(key: { [K in keyof HarnessState]: HarnessState[K] extends T ? K : never }[keyof HarnessState]) =>
    vi.fn((action: SetStateAction<T>) => {
      state[key] = resolveAction(action, state[key] as T) as HarnessState[typeof key]
    })

  // Faithful copy of useSimRuntimes.updateRuntime: merge patch over the
  // existing entry, auto-seeding emptyRuntime on first write.
  const updateRuntime = vi.fn((udid: string, patch: Partial<DeviceRuntime>) => {
    const cur = state.runtimes[udid] ?? emptyRuntime(udid)
    state.runtimes = { ...state.runtimes, [udid]: { ...cur, ...patch } }
  })

  const setters: SimWsSetters = {
    setRuntimes: track<RuntimesMap>('runtimes'),
    updateRuntime,
    setCurrentPosition: track<LatLng | null>('currentPosition'),
    setBackendPositionSynced: track<boolean>('backendPositionSynced'),
    setProgress: track<number>('progress'),
    setEta: track<number | null>('eta'),
    setStatus: track<SimulationStatus>('status'),
    setMode: vi.fn((next: string) => { state.mode = next }),
    setDestination: track<LatLng | null>('destination'),
    setWaypoints: track<LatLng[]>('waypoints'),
    setRoutePath: track<LatLng[]>('routePath'),
    setPauseEndAt: track<number | null>('pauseEndAt'),
    setWaypointProgress: track<HarnessState['waypointProgress']>('waypointProgress'),
    setLapProgress: track<HarnessState['lapProgress']>('lapProgress'),
    setDdiMounting: track<boolean>('ddiMounting'),
    setDdiMissing: track<HarnessState['ddiMissing']>('ddiMissing'),
    setError: track<string | null>('error'),
    localizeError: vi.fn((code) => `localized:${code}`),
  }

  let handler: ((m: WsMessage) => void) | undefined
  const unsubscribe = vi.fn()
  const subscribe: WsSubscribe = vi.fn((fn) => {
    handler = fn
    return unsubscribe
  })

  const { unmount } = renderHook(() => useSimWsDispatcher(subscribe, setters))

  const send = (type: string, data: unknown) => {
    act(() => { handler?.({ type, data }) })
  }

  return {
    state,
    setters,
    send,
    unmount,
    subscribe,
    unsubscribe,
    mocks: setters as unknown as Harness['mocks'],
  }
}

function calledSetterNames(h: Harness): string[] {
  return Object.keys(h.mocks)
    .filter((k) => typeof (h.mocks[k] as { mock?: unknown }).mock === 'object')
    .filter((k) => h.mocks[k].mock.calls.length > 0)
    .sort()
}

// ── (1) position_update: partial-payload merge ─────────────────────────

describe('position_update', () => {
  it('full payload writes both the runtime patch and every legacy setter', () => {
    const h = createHarness()
    h.send('position_update', {
      udid: UDID_A,
      lat: 25.04,
      lng: 121.56,
      progress: 0.5,
      eta_seconds: 120,
      distance_remaining: 800,
      distance_traveled: 200,
      speed_mps: 10,
    })

    // Runtime surface
    expect(h.state.runtimes[UDID_A]).toEqual({
      ...emptyRuntime(UDID_A),
      currentPos: { lat: 25.04, lng: 121.56 },
      progress: 0.5,
      eta: 120,
      distanceRemaining: 800,
      distanceTraveled: 200,
      currentSpeedKmh: 36, // speed_mps * 3.6
    })

    // Legacy surface
    expect(h.state.currentPosition).toEqual({ lat: 25.04, lng: 121.56 })
    expect(h.state.backendPositionSynced).toBe(true)
    expect(h.state.progress).toBe(0.5)
    expect(h.state.eta).toBe(120)
    expect(h.state.status).toEqual({
      running: false,
      paused: false,
      speed: 1,
      distance_remaining: 800,
      distance_traveled: 200,
    })
  })

  it('partial tick (lat/lng only) does NOT wipe cached eta/progress/distances on either surface', () => {
    const h = createHarness()
    h.send('position_update', {
      udid: UDID_A,
      lat: 1, lng: 2, progress: 0.4, eta_seconds: 99,
      distance_remaining: 500, distance_traveled: 100, speed_mps: 5,
    })
    h.send('position_update', { udid: UDID_A, lat: 3, lng: 4 })

    // Runtime: position moved, everything else retained.
    expect(h.state.runtimes[UDID_A].currentPos).toEqual({ lat: 3, lng: 4 })
    expect(h.state.runtimes[UDID_A].progress).toBe(0.4)
    expect(h.state.runtimes[UDID_A].eta).toBe(99)
    expect(h.state.runtimes[UDID_A].distanceRemaining).toBe(500)
    expect(h.state.runtimes[UDID_A].currentSpeedKmh).toBe(18)

    // Legacy: setProgress / setEta / setStatus called once each (only by the first frame).
    expect(h.setters.setProgress).toHaveBeenCalledTimes(1)
    expect(h.setters.setEta).toHaveBeenCalledTimes(1)
    expect(h.setters.setStatus).toHaveBeenCalledTimes(1)
    expect(h.state.eta).toBe(99)
    expect(h.state.currentPosition).toEqual({ lat: 3, lng: 4 })
  })

  it('eta_seconds takes precedence over eta on both surfaces', () => {
    const h = createHarness()
    h.send('position_update', { udid: UDID_A, eta: 100, eta_seconds: 42 })
    expect(h.state.runtimes[UDID_A].eta).toBe(42)
    expect(h.state.eta).toBe(42)
  })

  it('legacy eta falls back to `eta` when eta_seconds is absent', () => {
    const h = createHarness()
    h.send('position_update', { eta: 77 })
    expect(h.state.eta).toBe(77)
  })

  it('lat without lng is dropped — position only applies as a pair', () => {
    const h = createHarness()
    h.send('position_update', { udid: UDID_A, lat: 25.04, progress: 0.1 })
    expect(h.state.runtimes[UDID_A].currentPos).toBeNull()
    expect(h.setters.setCurrentPosition).not.toHaveBeenCalled()
    expect(h.setters.setBackendPositionSynced).not.toHaveBeenCalled()
    expect(h.state.progress).toBe(0.1)
  })

  it('payload with udid but no recognized fields skips updateRuntime entirely (empty patch)', () => {
    const h = createHarness()
    h.send('position_update', { udid: UDID_A })
    expect(h.setters.updateRuntime).not.toHaveBeenCalled()
    expect(h.state.runtimes).toEqual({})
  })

  it('payload without udid updates ONLY the legacy surface', () => {
    const h = createHarness()
    h.send('position_update', { lat: 1, lng: 2, progress: 0.3 })
    expect(h.state.runtimes).toEqual({})
    expect(h.setters.updateRuntime).not.toHaveBeenCalled()
    expect(h.setters.setRuntimes).not.toHaveBeenCalled()
    expect(h.state.currentPosition).toEqual({ lat: 1, lng: 2 })
    expect(h.state.progress).toBe(0.3)
  })

  it('non-object payload fires nothing on either surface', () => {
    const h = createHarness()
    h.send('position_update', null)
    h.send('position_update', 'garbage')
    expect(calledSetterNames(h)).toEqual([])
  })
})

// ── (2) state_change: idle vs paused vs running ────────────────────────

describe('state_change', () => {
  const seedRunning = (): Harness => {
    const h = createHarness({
      status: { running: true, paused: false, speed: 2, state: 'navigating' },
      routePath: [{ lat: 1, lng: 2 }],
      destination: { lat: 9, lng: 9 },
      eta: 60,
      runtimes: {
        [UDID_A]: {
          ...emptyRuntime(UDID_A),
          state: 'navigating',
          routePath: [{ lat: 1, lng: 2 }],
          destination: { lat: 9, lng: 9 },
          eta: 60,
        },
      },
    })
    return h
  }

  it.each(['idle', 'disconnected'])(
    '%s clears legacy routePath/destination/eta + running/paused; runtime clears routePath ONLY',
    (st) => {
      const h = seedRunning()
      h.send('state_change', { udid: UDID_A, state: st })

      // Legacy: full teardown.
      expect(h.state.status).toEqual({ running: false, paused: false, speed: 2, state: st })
      expect(h.state.routePath).toEqual([])
      expect(h.state.destination).toBeNull()
      expect(h.state.eta).toBeNull()

      // Runtime: state + routePath reset, but destination/eta are RETAINED.
      // Asymmetry with the legacy branch — pinned on purpose: the runtimes
      // mechanism (~line 268) only spreads `{ routePath: [] }` into the patch.
      expect(h.state.runtimes[UDID_A].state).toBe(st)
      expect(h.state.runtimes[UDID_A].routePath).toEqual([])
      expect(h.state.runtimes[UDID_A].destination).toEqual({ lat: 9, lng: 9 })
      expect(h.state.runtimes[UDID_A].eta).toBe(60)
    },
  )

  it('paused sets paused=true and state, but leaves running flag untouched', () => {
    const h = seedRunning()
    h.send('state_change', { udid: UDID_A, state: 'paused' })
    expect(h.state.status).toEqual({ running: true, paused: true, speed: 2, state: 'paused' })
    // Runtime keeps its routePath on pause.
    expect(h.state.runtimes[UDID_A].state).toBe('paused')
    expect(h.state.runtimes[UDID_A].routePath).toEqual([{ lat: 1, lng: 2 }])
  })

  it('any other state sets running=true, paused=false on legacy; runtime stores the raw state', () => {
    const h = createHarness()
    h.send('state_change', { udid: UDID_A, state: 'navigating' })
    expect(h.state.status).toEqual({ running: true, paused: false, speed: 1, state: 'navigating' })
    expect(h.state.runtimes[UDID_A].state).toBe('navigating')
    expect(h.state.routePath).toEqual([]) // untouched
  })

  it('missing state field fires nothing', () => {
    const h = createHarness()
    h.send('state_change', { udid: UDID_A })
    expect(calledSetterNames(h)).toEqual([])
  })
})

// ── (3) tunnel_degraded fan-out + device_connected clearing ────────────

describe('tunnel_degraded / tunnel_recovered / device_connected', () => {
  it('tunnel_degraded WITH udid flags only that runtime; other entries keep identity', () => {
    const h = createHarness({
      runtimes: { [UDID_A]: emptyRuntime(UDID_A), [UDID_B]: emptyRuntime(UDID_B) },
    })
    const untouchedB = h.state.runtimes[UDID_B]
    h.send('tunnel_degraded', { udid: UDID_A })
    expect(h.state.runtimes[UDID_A].tunnelDegraded).toBe(true)
    expect(h.state.runtimes[UDID_B].tunnelDegraded).toBe(false)
    expect(h.state.runtimes[UDID_B]).toBe(untouchedB)
    expect(h.setters.updateRuntime).toHaveBeenCalledWith(UDID_A, { tunnelDegraded: true })
    expect(h.setters.setRuntimes).not.toHaveBeenCalled()
  })

  it('tunnel_degraded WITHOUT udid fans out to ALL runtimes via setRuntimes', () => {
    const h = createHarness({
      runtimes: { [UDID_A]: emptyRuntime(UDID_A), [UDID_B]: emptyRuntime(UDID_B) },
    })
    h.send('tunnel_degraded', {})
    expect(h.state.runtimes[UDID_A].tunnelDegraded).toBe(true)
    expect(h.state.runtimes[UDID_B].tunnelDegraded).toBe(true)
    expect(h.setters.updateRuntime).not.toHaveBeenCalled()
    expect(h.setters.setRuntimes).toHaveBeenCalledTimes(1)
  })

  it('tunnel_recovered without udid clears all; a no-op pass returns the SAME map reference', () => {
    const h = createHarness({
      runtimes: {
        [UDID_A]: { ...emptyRuntime(UDID_A), tunnelDegraded: true },
        [UDID_B]: { ...emptyRuntime(UDID_B), tunnelDegraded: true },
      },
    })
    h.send('tunnel_recovered', {})
    expect(h.state.runtimes[UDID_A].tunnelDegraded).toBe(false)
    expect(h.state.runtimes[UDID_B].tunnelDegraded).toBe(false)

    // Second recovered with nothing degraded: functional updater returns prev.
    const before = h.state.runtimes
    h.send('tunnel_recovered', {})
    expect(h.state.runtimes).toBe(before)
  })

  it('device_connected clears stale tunnelDegraded for that udid and nulls the legacy error', () => {
    const h = createHarness({
      runtimes: { [UDID_A]: { ...emptyRuntime(UDID_A), state: 'navigating', tunnelDegraded: true } },
      error: 'localized:tunnel_lost',
    })
    h.send('device_connected', { udid: UDID_A })
    expect(h.state.runtimes[UDID_A].tunnelDegraded).toBe(false)
    // Other runtime fields survive the patch.
    expect(h.state.runtimes[UDID_A].state).toBe('navigating')
    expect(h.state.error).toBeNull()
  })

  it('device_connected for an unseen udid auto-seeds an empty runtime', () => {
    const h = createHarness()
    h.send('device_connected', { udid: UDID_B })
    expect(h.state.runtimes[UDID_B]).toEqual({ ...emptyRuntime(UDID_B), tunnelDegraded: false })
  })
})

// ── (4) *_complete: destination cleared ONLY on the legacy path ────────

describe('*_complete events', () => {
  it.each(['multi_stop_complete', 'navigation_complete', 'random_walk_complete'])(
    '%s clears legacy run overlays + destination; runtime gets progress=1/idle but KEEPS destination',
    (type) => {
      const h = createHarness({
        progress: 0.8,
        eta: 30,
        pauseEndAt: 12345,
        waypointProgress: { current: 1, next: 2, total: 3 },
        lapProgress: { current: 1, total: 5 },
        destination: { lat: 9, lng: 9 },
        runtimes: {
          [UDID_A]: {
            ...emptyRuntime(UDID_A),
            state: 'navigating',
            progress: 0.8,
            eta: 30,
            destination: { lat: 9, lng: 9 },
          },
        },
      })
      h.send(type, { udid: UDID_A })

      // Legacy: overlays collapsed AND destination cleared (~line 343).
      expect(h.state.progress).toBe(1)
      expect(h.state.eta).toBeNull()
      expect(h.state.pauseEndAt).toBeNull()
      expect(h.state.waypointProgress).toBeNull()
      expect(h.state.lapProgress).toBeNull()
      expect(h.state.destination).toBeNull()

      // Runtime: progress=1 + state idle, but destination (and eta) survive.
      // REAL ASYMMETRY, pinned deliberately: the runtimes branch (~line 297)
      // patches only { progress: 1, state: 'idle' } — it never clears
      // destination, so a refactor that unifies the branches must preserve
      // (or consciously change + re-pin) this difference.
      expect(h.state.runtimes[UDID_A].progress).toBe(1)
      expect(h.state.runtimes[UDID_A].state).toBe('idle')
      expect(h.state.runtimes[UDID_A].destination).toEqual({ lat: 9, lng: 9 })
      expect(h.state.runtimes[UDID_A].eta).toBe(30)
    },
  )

  it('legacy clearing fires even WITHOUT a udid (runtimes untouched)', () => {
    const h = createHarness({ destination: { lat: 1, lng: 1 }, progress: 0.5 })
    h.send('navigation_complete', {})
    expect(h.state.destination).toBeNull()
    expect(h.state.progress).toBe(1)
    expect(h.setters.updateRuntime).not.toHaveBeenCalled()
  })
})

// ── Remaining event details ────────────────────────────────────────────

describe('route_path coercion', () => {
  it('coerces tuple and object points on both surfaces; missing fields default to 0', () => {
    const h = createHarness()
    h.send('route_path', {
      udid: UDID_A,
      coords: [[1, 2], { lat: 3, lng: 4 }, { lat: 5 }, {}],
    })
    const expected = [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
      { lat: 5, lng: 0 },
      { lat: 0, lng: 0 },
    ]
    expect(h.state.runtimes[UDID_A].routePath).toEqual(expected)
    expect(h.state.routePath).toEqual(expected)
  })

  it('route_path without coords fires nothing', () => {
    const h = createHarness()
    h.send('route_path', { udid: UDID_A })
    expect(calledSetterNames(h)).toEqual([])
  })
})

describe('waypoint_progress / lap_complete defaults', () => {
  it('waypoint_progress: next defaults to current+1, total to 0; runtime stores waypointIndex', () => {
    const h = createHarness()
    h.send('waypoint_progress', { udid: UDID_A, current_index: 2 })
    expect(h.state.waypointProgress).toEqual({ current: 2, next: 3, total: 0 })
    expect(h.state.runtimes[UDID_A].waypointIndex).toBe(2)
  })

  it('waypoint_progress with explicit next/total uses them verbatim', () => {
    const h = createHarness()
    h.send('waypoint_progress', { udid: UDID_A, current_index: 1, next_index: 5, total: 7 })
    expect(h.state.waypointProgress).toEqual({ current: 1, next: 5, total: 7 })
  })

  it('lap_complete: total defaults to null; no runtime write (legacy-only event)', () => {
    const h = createHarness()
    h.send('lap_complete', { lap: 3 })
    expect(h.state.lapProgress).toEqual({ current: 3, total: null })
    h.send('lap_complete', { lap: 4, total: 10 })
    expect(h.state.lapProgress).toEqual({ current: 4, total: 10 })
    expect(h.setters.updateRuntime).not.toHaveBeenCalled()
  })
})

describe('pause_countdown / ddi / tunnel_lost / device_disconnected', () => {
  it('pause_countdown sets pauseEndAt = now + duration_seconds*1000; non-positive is ignored', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const h = createHarness()
    h.send('pause_countdown', { duration_seconds: 5 })
    expect(h.state.pauseEndAt).toBe(1_000_000 + 5000)
    h.send('pause_countdown', { duration_seconds: 0 })
    h.send('pause_countdown', {})
    expect(h.setters.setPauseEndAt).toHaveBeenCalledTimes(1)
  })

  it('ddi_mount_missing defaults reason to "unknown" and stamps ts with Date.now', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
    const h = createHarness({ ddiMounting: true })
    h.send('ddi_mount_missing', {})
    expect(h.state.ddiMounting).toBe(false)
    expect(h.state.ddiMissing).toEqual({ reason: 'unknown', stage: undefined, ts: 2_000_000 })

    h.send('ddi_mount_missing', { reason: 'no_image', stage: 'download' })
    expect(h.state.ddiMissing).toEqual({ reason: 'no_image', stage: 'download', ts: 2_000_000 })
  })

  it('tunnel_lost routes through localizeError into setError', () => {
    const h = createHarness()
    h.send('tunnel_lost', {})
    expect(h.setters.localizeError).toHaveBeenCalledWith('tunnel_lost')
    expect(h.state.error).toBe('localized:tunnel_lost')
  })

  it('device_disconnected: runtime → disconnected + tunnelDegraded reset; legacy → running/paused false', () => {
    const h = createHarness({
      status: { running: true, paused: true, speed: 2, state: 'paused' },
      runtimes: { [UDID_A]: { ...emptyRuntime(UDID_A), state: 'navigating', tunnelDegraded: true } },
    })
    h.send('device_disconnected', { udid: UDID_A })
    expect(h.state.runtimes[UDID_A]).toEqual({
      ...emptyRuntime(UDID_A),
      state: 'disconnected',
      tunnelDegraded: false,
    })
    // Legacy keeps `state` untouched — only the flags flip.
    expect(h.state.status).toEqual({ running: false, paused: false, speed: 2, state: 'paused' })
  })
})

// ── (5) Table: which setters fire per event ────────────────────────────

interface TableRow {
  name: string
  type: string
  data: unknown
  seed?: Partial<HarnessState>
  fires: string[]
}

const seededRuntimes = (): Partial<HarnessState> => ({
  runtimes: { [UDID_A]: emptyRuntime(UDID_A) },
})

const TABLE: TableRow[] = [
  {
    name: 'position_update with udid + full payload',
    type: 'position_update',
    data: { udid: UDID_A, lat: 1, lng: 2, progress: 0.1, eta_seconds: 9, distance_remaining: 5 },
    fires: ['setBackendPositionSynced', 'setCurrentPosition', 'setEta', 'setProgress', 'setStatus', 'updateRuntime'],
  },
  {
    name: 'position_update without udid (legacy only)',
    type: 'position_update',
    data: { lat: 1, lng: 2 },
    fires: ['setBackendPositionSynced', 'setCurrentPosition'],
  },
  {
    name: 'route_path with udid',
    type: 'route_path',
    data: { udid: UDID_A, coords: [[1, 2]] },
    fires: ['setRoutePath', 'updateRuntime'],
  },
  {
    name: 'route_path without udid',
    type: 'route_path',
    data: { coords: [[1, 2]] },
    fires: ['setRoutePath'],
  },
  {
    name: 'state_change running with udid',
    type: 'state_change',
    data: { udid: UDID_A, state: 'navigating' },
    fires: ['setStatus', 'updateRuntime'],
  },
  {
    name: 'state_change idle with udid',
    type: 'state_change',
    data: { udid: UDID_A, state: 'idle' },
    fires: ['setDestination', 'setEta', 'setRoutePath', 'setStatus', 'updateRuntime'],
  },
  {
    name: 'device_connected with udid',
    type: 'device_connected',
    data: { udid: UDID_A },
    fires: ['setError', 'setRuntimes'],
  },
  {
    name: 'device_connected WITHOUT udid is a no-op (udid-gated branch only)',
    type: 'device_connected',
    data: {},
    fires: [],
  },
  {
    name: 'device_disconnected with udid',
    type: 'device_disconnected',
    data: { udid: UDID_A },
    fires: ['setStatus', 'updateRuntime'],
  },
  {
    name: 'device_disconnected without udid (legacy status only)',
    type: 'device_disconnected',
    data: {},
    fires: ['setStatus'],
  },
  {
    name: 'navigation_complete with udid',
    type: 'navigation_complete',
    data: { udid: UDID_A },
    fires: ['setDestination', 'setEta', 'setLapProgress', 'setPauseEndAt', 'setProgress', 'setWaypointProgress', 'updateRuntime'],
  },
  {
    name: 'waypoint_progress with udid',
    type: 'waypoint_progress',
    data: { udid: UDID_A, current_index: 1 },
    fires: ['setWaypointProgress', 'updateRuntime'],
  },
  {
    name: 'waypoint_progress without current_index is a no-op',
    type: 'waypoint_progress',
    data: { udid: UDID_A },
    fires: [],
  },
  { name: 'lap_complete', type: 'lap_complete', data: { lap: 1 }, fires: ['setLapProgress'] },
  { name: 'ddi_mounting', type: 'ddi_mounting', data: {}, fires: ['setDdiMounting'] },
  { name: 'ddi_mounted', type: 'ddi_mounted', data: {}, fires: ['setDdiMounting'] },
  { name: 'ddi_mount_failed', type: 'ddi_mount_failed', data: {}, fires: ['setDdiMounting'] },
  {
    name: 'ddi_mount_missing',
    type: 'ddi_mount_missing',
    data: { reason: 'x' },
    fires: ['setDdiMissing', 'setDdiMounting'],
  },
  { name: 'tunnel_lost', type: 'tunnel_lost', data: {}, fires: ['localizeError', 'setError'] },
  {
    name: 'tunnel_degraded with udid',
    type: 'tunnel_degraded',
    data: { udid: UDID_A },
    seed: seededRuntimes(),
    fires: ['updateRuntime'],
  },
  {
    name: 'tunnel_degraded without udid',
    type: 'tunnel_degraded',
    data: {},
    seed: seededRuntimes(),
    fires: ['setRuntimes'],
  },
  {
    name: 'tunnel_recovered without udid',
    type: 'tunnel_recovered',
    data: {},
    seed: seededRuntimes(),
    fires: ['setRuntimes'],
  },
  {
    name: 'pause_countdown with positive duration',
    type: 'pause_countdown',
    data: { duration_seconds: 3 },
    fires: ['setPauseEndAt'],
  },
  { name: 'pause_countdown_end', type: 'pause_countdown_end', data: {}, fires: ['setPauseEndAt'] },
  // Contract event types the dispatcher deliberately does NOT handle today.
  { name: 'cooldown_update (unhandled)', type: 'cooldown_update', data: { udid: UDID_A }, fires: [] },
  { name: 'teleport (unhandled)', type: 'teleport', data: { udid: UDID_A, lat: 1, lng: 2 }, fires: [] },
  { name: 'stop_reached (unhandled)', type: 'stop_reached', data: { udid: UDID_A }, fires: [] },
  { name: 'restored (unhandled)', type: 'restored', data: {}, fires: [] },
  { name: 'totally unknown event type', type: 'not_a_real_event', data: {}, fires: [] },
]

describe('event → setters table', () => {
  it.each(TABLE)('$name fires exactly: $fires', (row) => {
    const h = createHarness(row.seed)
    h.send(row.type, row.data)
    expect(calledSetterNames(h)).toEqual([...row.fires].sort())
  })

  it('setMode and setWaypoints are NEVER called by the dispatcher (dead setters in the bag)', () => {
    const h = createHarness(seededRuntimes())
    for (const row of TABLE) h.send(row.type, row.data)
    expect(h.setters.setMode).not.toHaveBeenCalled()
    expect(h.setters.setWaypoints).not.toHaveBeenCalled()
  })
})

// ── Subscription lifecycle ─────────────────────────────────────────────

describe('subscription lifecycle', () => {
  it('subscribes once and unsubscribes on unmount', () => {
    const h = createHarness()
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    expect(h.unsubscribe).not.toHaveBeenCalled()
    h.unmount()
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('renders without crashing when subscribe is undefined', () => {
    const setters = createHarness().setters
    expect(() => {
      const { unmount } = renderHook(() => useSimWsDispatcher(undefined, setters))
      unmount()
    }).not.toThrow()
  })
})
