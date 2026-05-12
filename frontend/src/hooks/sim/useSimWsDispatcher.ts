/**
 * WebSocket dispatcher for simulation events.
 *
 * Subscribes to the shared WS stream and routes ~24 backend event types
 * to two parallel state surfaces:
 *
 *   1. The per-device `runtimes` map (group mode) — populated for every
 *      udid-tagged event so DeviceChip / EtaBar / per-device markers
 *      stay current.
 *   2. The legacy single-device state (currentPosition, status, mode,
 *      destination, waypoints, routePath, etc.) — read by older
 *      single-device components that haven't been migrated to consume
 *      from `runtimes` yet.
 *
 * The dispatcher itself owns no state; it accepts a bundle of setters
 * via a ref so the subscribe effect's deps stay `[subscribe]` and the
 * WS stream isn't torn down on every parent re-render. State setters
 * from `useState` are stable identity-wise, so the ref approach is
 * defensive but cheap.
 */

import { useEffect, useRef } from 'react'
import type { LatLng } from './types'
import type { DeviceRuntime, RuntimesMap } from './useSimRuntimes'
import { emptyRuntime } from './useSimRuntimes'
import type { WsMessage } from '../useWebSocket'

// ── Typed WS payloads ──────────────────────────────────────────────────

interface PositionUpdatePayload {
  udid?: string
  lat?: number
  lng?: number
  progress?: number
  eta?: number
  eta_seconds?: number
  distance_remaining?: number
  distance_traveled?: number
  speed_mps?: number
}

interface RoutePathPayload {
  udid?: string
  coords?: ReadonlyArray<{ lat?: number; lng?: number } | [number, number]>
}

interface StateChangePayload {
  udid?: string
  state?: string
}

interface WaypointProgressPayload {
  udid?: string
  current_index?: number
  next_index?: number
  total?: number
}

interface LapCompletePayload {
  lap?: number
  total?: number
}

interface PauseCountdownPayload {
  duration_seconds?: number
}

interface DdiMountMissingPayload {
  reason?: string
  stage?: string
}

// ── Type guards ────────────────────────────────────────────────────────

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v != null ? v as Record<string, unknown> : null
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

function parsePositionUpdate(data: unknown): PositionUpdatePayload | null {
  const o = asObject(data)
  if (!o) return null
  return {
    udid: asString(o.udid),
    lat: asNumber(o.lat),
    lng: asNumber(o.lng),
    progress: asNumber(o.progress),
    eta: asNumber(o.eta),
    eta_seconds: asNumber(o.eta_seconds),
    distance_remaining: asNumber(o.distance_remaining),
    distance_traveled: asNumber(o.distance_traveled),
    speed_mps: asNumber(o.speed_mps),
  }
}

function parseRoutePath(data: unknown): RoutePathPayload | null {
  const o = asObject(data)
  if (!o) return null
  return {
    udid: asString(o.udid),
    coords: Array.isArray(o.coords) ? o.coords as RoutePathPayload['coords'] : undefined,
  }
}

function parseStateChange(data: unknown): StateChangePayload | null {
  const o = asObject(data)
  if (!o) return null
  return { udid: asString(o.udid), state: asString(o.state) }
}

function parseWaypointProgress(data: unknown): WaypointProgressPayload | null {
  const o = asObject(data)
  if (!o) return null
  return {
    udid: asString(o.udid),
    current_index: asNumber(o.current_index),
    next_index: asNumber(o.next_index),
    total: asNumber(o.total),
  }
}

function parseLapComplete(data: unknown): LapCompletePayload | null {
  const o = asObject(data)
  if (!o) return null
  return { lap: asNumber(o.lap), total: asNumber(o.total) }
}

function parsePauseCountdown(data: unknown): PauseCountdownPayload | null {
  const o = asObject(data)
  if (!o) return null
  return { duration_seconds: asNumber(o.duration_seconds) }
}

function parseDdiMountMissing(data: unknown): DdiMountMissingPayload {
  const o = asObject(data) ?? {}
  return { reason: asString(o.reason), stage: asString(o.stage) }
}

function extractUdid(data: unknown): string | undefined {
  const o = asObject(data)
  return o ? asString(o.udid) : undefined
}

// Coerce a tuple/object polyline point into LatLng. Used when a route_path
// payload carries [lat, lng] arrays instead of {lat, lng} objects.
function coordOf(p: { lat?: number; lng?: number } | [number, number] | unknown): LatLng {
  if (Array.isArray(p)) return { lat: p[0] as number, lng: p[1] as number }
  const po = asObject(p) ?? {}
  return { lat: asNumber(po.lat) ?? 0, lng: asNumber(po.lng) ?? 0 }
}

// ── Public hook ────────────────────────────────────────────────────────

export type WsSubscribe = (fn: (m: WsMessage) => void) => () => void

// SimErrorCode tags an error surface this hook hands to consumers via
// `localizeError`. Currently the only real producer is the `tunnel_lost`
// WS handler below — anchored to the generated `WsEventType` union so a
// backend rename/removal propagates as a TypeScript error here instead
// of a silent miss.
import type { WsEventType } from '../../generated/api-contract'
export type SimErrorCode = Extract<WsEventType, 'tunnel_lost'>

export interface SimulationStatus {
  running: boolean
  paused: boolean
  speed: number
  state?: string
  distance_remaining?: number
  distance_traveled?: number
}

/**
 * Bundle of setters the dispatcher writes to. All entries should come
 * from `useState` or stable `useCallback` so identity stays put across
 * renders — the dispatcher captures this object via a ref each render
 * and the WS subscribe effect itself only depends on `subscribe`.
 */
export interface SimWsSetters {
  // Per-device runtime
  setRuntimes: React.Dispatch<React.SetStateAction<RuntimesMap>>
  updateRuntime: (udid: string, patch: Partial<DeviceRuntime>) => void
  // Legacy single-device state
  setCurrentPosition: React.Dispatch<React.SetStateAction<LatLng | null>>
  setBackendPositionSynced: React.Dispatch<React.SetStateAction<boolean>>
  setProgress: React.Dispatch<React.SetStateAction<number>>
  setEta: React.Dispatch<React.SetStateAction<number | null>>
  setStatus: React.Dispatch<React.SetStateAction<SimulationStatus>>
  setMode: (next: string) => void
  setDestination: React.Dispatch<React.SetStateAction<LatLng | null>>
  setWaypoints: React.Dispatch<React.SetStateAction<LatLng[]>>
  setRoutePath: React.Dispatch<React.SetStateAction<LatLng[]>>
  setPauseEndAt: React.Dispatch<React.SetStateAction<number | null>>
  setWaypointProgress: React.Dispatch<
    React.SetStateAction<{ current: number; next: number; total: number } | null>
  >
  setLapProgress: React.Dispatch<
    React.SetStateAction<{ current: number; total: number | null } | null>
  >
  setDdiMounting: React.Dispatch<React.SetStateAction<boolean>>
  setDdiMissing: React.Dispatch<
    React.SetStateAction<{ reason: string; stage?: string; ts: number } | null>
  >
  setError: React.Dispatch<React.SetStateAction<string | null>>
  localizeError: (code: SimErrorCode) => string
}

/**
 * Wire incoming WS messages into the simulation state setters. Returns
 * nothing — the hook only owns the subscribe effect.
 */
export function useSimWsDispatcher(
  subscribe: WsSubscribe | undefined,
  setters: SimWsSetters,
): void {
  // Keep the latest setters bag in a ref so the subscribe effect doesn't
  // need them in its deps (which would otherwise tear down + rebuild the
  // WS subscription on every parent render).
  const settersRef = useRef(setters)
  useEffect(() => { settersRef.current = setters }, [setters])

  useEffect(() => {
    if (!subscribe) return
    return subscribe((wsMessage) => {
      const s = settersRef.current

      // ── Group mode: mirror per-device state into `runtimes` map ────
      const udid = extractUdid(wsMessage.data)
      if (udid) {
        switch (wsMessage.type) {
          case 'position_update': {
            const d = parsePositionUpdate(wsMessage.data)
            if (!d) break
            // Only include a key when the incoming payload carries it,
            // so a tick without `eta` doesn't wipe the cached value.
            const patch: Partial<DeviceRuntime> = {}
            if (d.lat != null && d.lng != null) {
              patch.currentPos = { lat: d.lat, lng: d.lng }
            }
            if (d.progress != null) patch.progress = d.progress
            const etaVal = d.eta_seconds ?? d.eta
            if (etaVal != null) patch.eta = etaVal
            if (d.distance_remaining != null) patch.distanceRemaining = d.distance_remaining
            if (d.distance_traveled != null) patch.distanceTraveled = d.distance_traveled
            if (d.speed_mps != null) patch.currentSpeedKmh = d.speed_mps * 3.6
            if (Object.keys(patch).length > 0) s.updateRuntime(udid, patch)
            break
          }
          case 'route_path': {
            const d = parseRoutePath(wsMessage.data)
            if (d?.coords) {
              s.updateRuntime(udid, { routePath: d.coords.map(coordOf) })
            }
            break
          }
          case 'state_change': {
            const d = parseStateChange(wsMessage.data)
            if (d?.state) {
              s.updateRuntime(udid, {
                state: d.state,
                ...(d.state === 'idle' || d.state === 'disconnected' ? { routePath: [] } : {}),
              })
            }
            break
          }
          case 'device_connected': {
            s.setRuntimes((prev) => prev[udid] ? prev : { ...prev, [udid]: emptyRuntime(udid) })
            // A device reconnecting implicitly resolves any prior connection-
            // loss banner (watchdog auto-connect now broadcasts `device_connected`
            // rather than `device_reconnected`; the legacy case still handles
            // the latter).
            s.setError(null)
            break
          }
          case 'device_disconnected': {
            s.updateRuntime(udid, { state: 'disconnected' })
            break
          }
          case 'multi_stop_complete':
          case 'navigation_complete':
          case 'random_walk_complete': {
            s.updateRuntime(udid, { progress: 1, state: 'idle' })
            break
          }
          case 'waypoint_progress': {
            const d = parseWaypointProgress(wsMessage.data)
            if (d?.current_index != null) {
              s.updateRuntime(udid, { waypointIndex: d.current_index })
            }
            break
          }
        }
      }

      // ── Legacy single-device state ─────────────────────────────────
      switch (wsMessage.type) {
        case 'position_update': {
          const d = parsePositionUpdate(wsMessage.data)
          if (!d) break
          if (d.lat != null && d.lng != null) {
            s.setCurrentPosition({ lat: d.lat, lng: d.lng })
            s.setBackendPositionSynced(true)
          }
          if (d.progress != null) s.setProgress(d.progress)
          const etaVal = d.eta_seconds ?? d.eta
          if (etaVal != null) s.setEta(etaVal)
          if (d.distance_remaining != null || d.distance_traveled != null) {
            s.setStatus((prev) => ({
              ...prev,
              ...(d.distance_remaining != null ? { distance_remaining: d.distance_remaining } : {}),
              ...(d.distance_traveled != null ? { distance_traveled: d.distance_traveled } : {}),
            }))
          }
          break
        }
        case 'multi_stop_complete':
        case 'navigation_complete':
        case 'random_walk_complete': {
          // Run finished — collapse the dock back to idle. `state_change`
          // → 'idle' arrives separately and clears `running`/`paused`/
          // `routePath`; this case clears the per-run progress overlays
          // those don't touch.
          s.setProgress(1)
          s.setEta(null)
          s.setPauseEndAt(null)
          s.setWaypointProgress(null)
          s.setLapProgress(null)
          s.setDestination(null)
          break
        }
        case 'waypoint_progress': {
          const d = parseWaypointProgress(wsMessage.data)
          if (d?.current_index != null) {
            s.setWaypointProgress({
              current: d.current_index,
              next: d.next_index ?? d.current_index + 1,
              total: d.total ?? 0,
            })
          }
          break
        }
        case 'lap_complete': {
          const d = parseLapComplete(wsMessage.data)
          if (d?.lap != null) {
            s.setLapProgress({
              current: d.lap,
              total: d.total ?? null,
            })
          }
          break
        }
        case 'ddi_mounting': {
          s.setDdiMounting(true)
          break
        }
        case 'ddi_mounted':
        case 'ddi_mount_failed': {
          s.setDdiMounting(false)
          break
        }
        case 'ddi_mount_missing': {
          // Auto-mount failed. The SimContext observer will surface a
          // single hint toast so the user knows what to do next.
          s.setDdiMounting(false)
          const d = parseDdiMountMissing(wsMessage.data)
          s.setDdiMissing({
            reason: d.reason ?? 'unknown',
            stage: d.stage,
            ts: Date.now(),
          })
          break
        }
        case 'tunnel_lost': {
          s.setError(s.localizeError('tunnel_lost'))
          break
        }
        case 'device_disconnected': {
          // User-facing notice is a toast fired by App.tsx off
          // device.lastDisconnect (canonical Toast per DESIGN.md §4),
          // which picks a cause-specific copy. The legacy ErrorBanner
          // path was removed: banner isn't in DESIGN.md and DeviceChip's
          // "已斷線" pill already persists the state until reconnect.
          s.setStatus((prev) => ({ ...prev, running: false, paused: false }))
          break
        }
        // `device_reconnected` removed — the watchdog now emits
        // `device_connected` after a re-plug, which clears the error
        // via the existing case below.
        case 'pause_countdown': {
          const d = parsePauseCountdown(wsMessage.data)
          const dur = d?.duration_seconds
          if (typeof dur === 'number' && dur > 0) {
            s.setPauseEndAt(Date.now() + dur * 1000)
          }
          break
        }
        case 'pause_countdown_end': {
          s.setPauseEndAt(null)
          break
        }
        case 'route_path': {
          const d = parseRoutePath(wsMessage.data)
          if (d?.coords) {
            s.setRoutePath(d.coords.map(coordOf))
          }
          break
        }
        case 'state_change': {
          const st = parseStateChange(wsMessage.data)?.state
          if (st === 'idle' || st === 'disconnected') {
            s.setStatus((prev) => ({ ...prev, running: false, paused: false, state: st }))
            s.setRoutePath([])
            s.setDestination(null)
            s.setEta(null)
          } else if (st === 'paused') {
            s.setStatus((prev) => ({ ...prev, paused: true, state: st }))
          } else if (st) {
            s.setStatus((prev) => ({ ...prev, running: true, paused: false, state: st }))
          }
          break
        }
      }
    })
  }, [subscribe])
}
