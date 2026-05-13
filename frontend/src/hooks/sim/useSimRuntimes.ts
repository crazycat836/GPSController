/**
 * Per-device simulation runtime state (group mode).
 *
 * Each connected device gets a slot in the `runtimes` map keyed by udid.
 * Slots are populated by `useSimWsDispatcher` from incoming
 * `position_update` / `state_change` / `route_path` / `waypoint_progress`
 * / `device_connected` events. Consumers (DeviceChip, EtaBar) read the
 * map to render per-device markers, ETAs, and chips.
 */

import { useState, useCallback } from 'react'
import type { LatLng } from './types'

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
  // True between a `tunnel_degraded` and the next `tunnel_recovered` /
  // terminal `device_disconnected`. Orthogonal to `state` — the engine
  // can still be NAVIGATING while the underlying DVT channel is being
  // re-handshaked. DeviceChip overlays the "reconnecting" pulse on top
  // of whatever state is showing.
  tunnelDegraded: boolean
}

export type RuntimesMap = Record<string, DeviceRuntime>

export function emptyRuntime(udid: string): DeviceRuntime {
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
    tunnelDegraded: false,
  }
}

export interface UseSimRuntimesValue {
  runtimes: RuntimesMap
  setRuntimes: React.Dispatch<React.SetStateAction<RuntimesMap>>
  /** Patch a single device's runtime; auto-creates an empty entry on first
   *  write so callers don't have to pre-seed the map. */
  updateRuntime: (udid: string, patch: Partial<DeviceRuntime>) => void
}

export function useSimRuntimes(): UseSimRuntimesValue {
  const [runtimes, setRuntimes] = useState<RuntimesMap>({})
  const updateRuntime = useCallback((udid: string, patch: Partial<DeviceRuntime>) => {
    setRuntimes((prev) => {
      const cur = prev[udid] ?? emptyRuntime(udid)
      return { ...prev, [udid]: { ...cur, ...patch } }
    })
  }, [])
  return { runtimes, setRuntimes, updateRuntime }
}
