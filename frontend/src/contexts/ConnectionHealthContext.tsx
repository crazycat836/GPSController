import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useDeviceContext } from './DeviceContext'

// Transport layer: raw WebSocket reachability to the Python backend.
// `reconnecting` = briefly offline (< OFFLINE_THRESHOLD_MS), auto-retry
// still in progress. `offline` = extended outage; the user should know
// the app is not in touch with the backend at all.
export type WsState = 'open' | 'reconnecting' | 'offline'

// Domain layer: the combined view over `useDevice`. `stale` is the
// transport-degraded variant of `connected` — we still have a device
// cached as connected, but WS is down, so the cache cannot be trusted.
export type DeviceHealth = 'connected' | 'lost' | 'none' | 'stale'

// Discriminator for UI hints. Consumers map this to an i18n key; keeping
// it as an enum here decouples the health model from the translation
// catalog so tests / new surfaces don't need to know about i18n.
export type HealthHint = null | 'ws_reconnecting' | 'ws_offline' | 'device_lost'

export interface ConnectionHealth {
  ws: WsState
  device: DeviceHealth
  /** True iff it is safe to send a command right now (WS open AND a
   *  device is actually connected). Intended for disabling action
   *  buttons — consumers can trust a positive value. */
  canOperate: boolean
  /** The most-urgent human-facing condition worth surfacing. `null`
   *  when everything is healthy. */
  hint: HealthHint
}

const ConnectionHealthContext = createContext<ConnectionHealth | null>(null)

// How long WS has to be down before the UI escalates from "reconnecting"
// (transient, probably fine) to "offline" (user should act).
// 10s covers most dev-mode HMR reconnects and backend restart; longer
// than that and we want to alarm.
const OFFLINE_THRESHOLD_MS = 10_000

interface ConnectionHealthProviderProps {
  /** Raw transport state from `useWebSocket().connected`. Passed in as a
   *  prop so the hook stays single-ownership inside `App`; we don't want
   *  two `useWebSocket` call sites. */
  wsConnected: boolean
  children: React.ReactNode
}

export function ConnectionHealthProvider({ wsConnected, children }: ConnectionHealthProviderProps) {
  const device = useDeviceContext()

  // `now` is a heartbeat that forces the memo below to re-evaluate the
  // reconnecting→offline threshold while WS is down. Only ticks while
  // offline — when connected, no interval runs, so steady-state renders
  // cost nothing.
  const [now, setNow] = useState(() => Date.now())
  const disconnectedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (wsConnected) {
      disconnectedAtRef.current = null
      return
    }
    if (disconnectedAtRef.current == null) {
      disconnectedAtRef.current = Date.now()
    }
    // 500ms cadence is enough to animate a countdown-ish escalation;
    // the memo only re-runs when `now` crosses OFFLINE_THRESHOLD_MS.
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [wsConnected])

  const connectedCount = device.connectedDevices.length
  const lostCount = device.lostUdids.size

  const health = useMemo<ConnectionHealth>(() => {
    let ws: WsState
    if (wsConnected) {
      ws = 'open'
    } else {
      const since = disconnectedAtRef.current
      const offlineMs = since == null ? 0 : now - since
      ws = offlineMs >= OFFLINE_THRESHOLD_MS ? 'offline' : 'reconnecting'
    }

    let deviceState: DeviceHealth
    if (ws !== 'open' && connectedCount > 0) {
      deviceState = 'stale'
    } else if (connectedCount > 0) {
      deviceState = 'connected'
    } else if (lostCount > 0) {
      deviceState = 'lost'
    } else {
      deviceState = 'none'
    }

    const canOperate = ws === 'open' && deviceState === 'connected'

    // Severity order: WS outage dominates (nothing works), then device
    // loss. Consumers showing a single banner can just read `hint`.
    let hint: HealthHint = null
    if (ws === 'offline') hint = 'ws_offline'
    else if (ws === 'reconnecting') hint = 'ws_reconnecting'
    else if (deviceState === 'lost') hint = 'device_lost'

    return { ws, device: deviceState, canOperate, hint }
  }, [wsConnected, now, connectedCount, lostCount])

  return (
    <ConnectionHealthContext.Provider value={health}>
      {children}
    </ConnectionHealthContext.Provider>
  )
}

export function useConnectionHealth(): ConnectionHealth {
  const ctx = useContext(ConnectionHealthContext)
  if (!ctx) throw new Error('useConnectionHealth must be used within ConnectionHealthProvider')
  return ctx
}
