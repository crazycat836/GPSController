/**
 * WebSocket dispatcher for device-state events.
 *
 * Subscribes to the shared WS stream and routes the three device-lifecycle
 * events — `device_connected`, `device_disconnected`, `device_reconnected` —
 * into the parent `useDevice` hook's state.
 *
 * Owns no state itself: receives a setters bundle via ref so the subscribe
 * effect's dep list stays `[subscribe]` and the WS stream isn't torn down
 * on every parent re-render. Mirrors the pattern in `sim/useSimWsDispatcher`.
 *
 * The bundled `bumpWsGen` is invoked on every WS-driven state change so
 * the REST flows in `useDevice` (scan / connect / forget) can detect
 * "did a WS event race past me while I was awaiting?" and skip the
 * post-await apply when so.
 */

import { useEffect, useRef } from 'react'
import {
  parseDeviceConnected,
  parseDeviceDisconnected,
  parseDeviceReconnected,
} from './parsers'
import type { DeviceInfo, WsSubscribe } from './parsers'

export interface DeviceWsSetters {
  setDevices: React.Dispatch<React.SetStateAction<DeviceInfo[]>>
  setConnectedDevice: React.Dispatch<React.SetStateAction<DeviceInfo | null>>
  setLostUdids: React.Dispatch<React.SetStateAction<Set<string>>>
  bumpWsGen: () => void
}

export function useDeviceWs(
  subscribe: WsSubscribe | undefined,
  setters: DeviceWsSetters,
): void {
  // Keep the latest setters bag in a ref so the subscribe effect doesn't
  // need them in its deps — mirrors useSimWsDispatcher.
  const settersRef = useRef(setters)
  useEffect(() => { settersRef.current = setters }, [setters])

  // React to real-time device state broadcasts via the subscribe callback.
  // See useWebSocket.ts for the rationale vs the old useState pattern.
  //
  // We update `devices` from the broadcast payload directly rather than
  // re-fetching /api/device/list. Every event that reaches this handler
  // already carries the udid + (for connect) name / ios_version /
  // connection_type, which is enough to keep the list in sync. An
  // earlier revision re-fetched after every event; in dev with multiple
  // WS clients that produced dozens of /api/device/list requests per
  // second. If a field we don't receive here is needed (e.g.
  // developer_mode_enabled), fetch it lazily at the point of use.
  useEffect(() => {
    if (!subscribe) return
    return subscribe((msg) => {
      const s = settersRef.current
      if (msg.type === 'device_disconnected') {
        s.bumpWsGen()
        // Group mode: only mark the specific udid disconnected when provided;
        // fall back to clearing all for legacy single-device disconnect events.
        const payload = parseDeviceDisconnected(msg.data)
        const udids: readonly string[] = payload.udids ?? (payload.udid ? [payload.udid] : [])
        // user-initiated disconnects don't warrant a "lost" pill
        const involuntary = payload.reason !== 'user'
        if (udids.length === 0) {
          s.setConnectedDevice(null)
          s.setDevices((prev) => {
            if (involuntary) {
              const prevConnected = prev.filter((d) => d.is_connected).map((d) => d.udid)
              if (prevConnected.length > 0) {
                s.setLostUdids((ls) => { const n = new Set(ls); prevConnected.forEach((u) => n.add(u)); return n })
              }
            }
            return prev.map((d) => ({ ...d, is_connected: false }))
          })
        } else {
          s.setDevices((prev) => prev.map((d) => udids.includes(d.udid) ? { ...d, is_connected: false } : d))
          s.setConnectedDevice((prev) => (prev && udids.includes(prev.udid)) ? null : prev)
          if (involuntary) {
            s.setLostUdids((ls) => { const n = new Set(ls); udids.forEach((u) => n.add(u)); return n })
          }
        }
      } else if (msg.type === 'device_connected') {
        const payload = parseDeviceConnected(msg.data)
        if (!payload) return
        s.bumpWsGen()
        const incoming: DeviceInfo = {
          udid: payload.udid,
          name: payload.name ?? '',
          ios_version: payload.ios_version ?? '',
          connection_type: payload.connection_type ?? 'USB',
          is_connected: true,
        }
        // `merged` holds the post-update entry for this udid; we thread
        // the same reference into both `devices` and `connectedDevice`
        // so consumers can't observe a split where one has
        // `developer_mode_*` fields and the other doesn't.
        let merged: DeviceInfo = incoming
        s.setDevices((prev) => {
          const idx = prev.findIndex((d) => d.udid === payload.udid)
          if (idx === -1) {
            merged = incoming
            return [...prev, incoming]
          }
          const existing = prev[idx]
          // Short-circuit: if every visible field already matches, keep
          // the existing reference so downstream useMemo / render trees
          // don't invalidate on a no-op re-broadcast.
          if (
            existing.is_connected &&
            existing.name === incoming.name &&
            existing.ios_version === incoming.ios_version &&
            existing.connection_type === incoming.connection_type
          ) {
            merged = existing
            return prev
          }
          // Preserve developer_mode_* fields we may already have cached
          // from an earlier scan — they aren't in the broadcast payload.
          merged = { ...existing, ...incoming }
          const next = prev.slice()
          next[idx] = merged
          return next
        })
        s.setConnectedDevice((prev) => prev ?? merged)
        s.setLostUdids((ls) => { if (!ls.has(payload.udid)) return ls; const n = new Set(ls); n.delete(payload.udid); return n })
      } else if (msg.type === 'device_reconnected') {
        const payload = parseDeviceReconnected(msg.data)
        if (!payload) return
        s.bumpWsGen()
        const { udid } = payload
        s.setDevices((prev) => {
          const idx = prev.findIndex((d) => d.udid === udid)
          if (idx === -1) return prev
          if (prev[idx].is_connected) return prev
          const next = prev.slice()
          next[idx] = { ...prev[idx], is_connected: true }
          return next
        })
        s.setConnectedDevice((prev) => {
          if (prev && prev.udid === udid) return { ...prev, is_connected: true }
          return prev
        })
        s.setLostUdids((ls) => { if (!ls.has(udid)) return ls; const n = new Set(ls); n.delete(udid); return n })
      }
    })
  }, [subscribe])
}
