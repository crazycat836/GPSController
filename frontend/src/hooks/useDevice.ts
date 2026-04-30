import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { DEFAULT_TUNNEL_PORT } from '../lib/constants'
import {
  listDevices, connectDevice, disconnectDevice, forgetDevice,
  clearAutoReconnectBlocks,
  wifiConnect, wifiScan,
  wifiTunnelStartAndConnect, wifiTunnelStatus, wifiTunnelStop,
} from '../services/api'
import type { WsMessage } from './useWebSocket'

// Coalesce burst scans (visibility-change + WS-reconnect debounce can
// both fire within ~200ms). When `poll: true` AND another poll ran
// within SCAN_COALESCE_MS, skip — manual scans always go through.
const SCAN_COALESCE_MS = 1500

// Only log to the DevTools console in dev builds; production (packaged
// Electron) has no attached console and these would add noise if anyone
// ever attached one. Uses console.warn so informational "scan failed /
// connect failed" lines don't light up red + trigger the DevTools error
// overlay — they're recoverable, not faults.
const _IS_DEV = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
function devLog(...args: unknown[]): void {
  if (_IS_DEV) {
    // eslint-disable-next-line no-console
    console.warn(...args)
  }
}

export interface DeviceInfo {
  udid: string
  name: string
  ios_version: string
  connection_type: string
  is_connected: boolean
  /** Raw toggle state — usually not needed by the frontend. Consume
   *  `can_reveal_developer_mode` instead. */
  developer_mode_enabled?: boolean | null
  /** True when all preconditions for the AMFI "Reveal Developer Mode"
   *  action are met (connected, USB, iOS 16+, toggle OFF). */
  can_reveal_developer_mode?: boolean
}

export interface WifiScanResult {
  ip: string
  name: string
  udid: string
  ios_version: string
}

export type WsSubscribe = (fn: (m: WsMessage) => void) => () => void

// Discriminated union of every WS event this hook reacts to. `WsMessage`
// itself is intentionally `unknown`-typed (see useWebSocket.ts); these
// guards narrow it once at the entry point so the rest of the handler
// reads payloads as plain TypeScript.
//
// Reason for `as any` originally: the backend emits ~24 event types and
// nobody wanted to enumerate all of them. Reason for replacing it: the
// device events are a small stable subset, and silent payload drift
// (e.g. backend renaming `udid` → `device_id`) was invisible to TS.
interface DeviceConnectedPayload {
  udid: string
  name?: string
  ios_version?: string
  connection_type?: string
}

interface DeviceDisconnectedPayload {
  udid?: string
  udids?: readonly string[]
  reason?: string
}

interface DeviceReconnectedPayload {
  udid: string
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v != null ? v as Record<string, unknown> : null
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined
  if (v.every((x): x is string => typeof x === 'string')) return v
  return undefined
}

function parseDeviceConnected(data: unknown): DeviceConnectedPayload | null {
  const obj = asObject(data)
  if (!obj) return null
  const udid = asString(obj.udid)
  if (!udid) return null
  return {
    udid,
    name: asString(obj.name),
    ios_version: asString(obj.ios_version),
    connection_type: asString(obj.connection_type),
  }
}

function parseDeviceDisconnected(data: unknown): DeviceDisconnectedPayload {
  const obj = asObject(data) ?? {}
  return {
    udid: asString(obj.udid),
    udids: asStringArray(obj.udids),
    reason: asString(obj.reason),
  }
}

function parseDeviceReconnected(data: unknown): DeviceReconnectedPayload | null {
  const obj = asObject(data)
  if (!obj) return null
  const udid = asString(obj.udid)
  if (!udid) return null
  return { udid }
}

function deviceListEqual(a: readonly DeviceInfo[], b: readonly DeviceInfo[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.udid !== y.udid ||
      x.name !== y.name ||
      x.ios_version !== y.ios_version ||
      x.connection_type !== y.connection_type ||
      x.is_connected !== y.is_connected ||
      x.developer_mode_enabled !== y.developer_mode_enabled ||
      x.can_reveal_developer_mode !== y.can_reveal_developer_mode
    ) return false
  }
  return true
}

export function useDevice(subscribe?: WsSubscribe) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [connectedDevice, setConnectedDevice] = useState<DeviceInfo | null>(null)
  // UDIDs that were connected and then lost involuntarily (DVT reconnect
  // exhausted, USB unplug, WiFi tunnel died). Used by DeviceDrawer to
  // distinguish "just disconnected" from "never connected / Ready" — both
  // share is_connected=false but the former deserves a red "已斷線" pill.
  // Cleared when the UDID reappears connected, or on a fresh scan.
  const [lostUdids, setLostUdids] = useState<Set<string>>(() => new Set())

  // Bumped every time a WS-driven state change is applied (connected /
  // disconnected / reconnected). Used by REST flows (scan/connect/
  // disconnect) to detect "did a WS event race past me while I was
  // awaiting?" — if so, the WS event is authoritative and we skip the
  // post-await `setDevices` apply that would clobber it. See the
  // auto-connect path in `scan` for the canonical use.
  const wsEventGenRef = useRef(0)
  const bumpWsGen = useCallback(() => { wsEventGenRef.current += 1 }, [])

  // Frontend boot — tell the backend to drop any "user-disconnected"
  // marks from the prior session. A fresh page load is the user
  // re-engaging with the app, so every paired device should be
  // eligible for auto-reconnect again. Errors are non-fatal (the
  // endpoint is best-effort cleanup).
  useEffect(() => {
    clearAutoReconnectBlocks().catch((err) => devLog('clearAutoReconnectBlocks failed', err))
  }, [])

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
      if (msg.type === 'device_disconnected') {
        bumpWsGen()
        // Group mode: only mark the specific udid disconnected when provided;
        // fall back to clearing all for legacy single-device disconnect events.
        const payload = parseDeviceDisconnected(msg.data)
        const udids: readonly string[] = payload.udids ?? (payload.udid ? [payload.udid] : [])
        // user-initiated disconnects don't warrant a "lost" pill
        const involuntary = payload.reason !== 'user'
        if (udids.length === 0) {
          setConnectedDevice(null)
          setDevices((prev) => {
            if (involuntary) {
              const prevConnected = prev.filter((d) => d.is_connected).map((d) => d.udid)
              if (prevConnected.length > 0) {
                setLostUdids((s) => { const n = new Set(s); prevConnected.forEach((u) => n.add(u)); return n })
              }
            }
            return prev.map((d) => ({ ...d, is_connected: false }))
          })
        } else {
          setDevices((prev) => prev.map((d) => udids.includes(d.udid) ? { ...d, is_connected: false } : d))
          setConnectedDevice((prev) => (prev && udids.includes(prev.udid)) ? null : prev)
          if (involuntary) {
            setLostUdids((s) => { const n = new Set(s); udids.forEach((u) => n.add(u)); return n })
          }
        }
      } else if (msg.type === 'device_connected') {
        const payload = parseDeviceConnected(msg.data)
        if (!payload) return
        bumpWsGen()
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
        setDevices((prev) => {
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
        setConnectedDevice((prev) => prev ?? merged)
        setLostUdids((s) => { if (!s.has(payload.udid)) return s; const n = new Set(s); n.delete(payload.udid); return n })
      } else if (msg.type === 'device_reconnected') {
        const payload = parseDeviceReconnected(msg.data)
        if (!payload) return
        bumpWsGen()
        const { udid } = payload
        setDevices((prev) => {
          const idx = prev.findIndex((d) => d.udid === udid)
          if (idx === -1) return prev
          if (prev[idx].is_connected) return prev
          const next = prev.slice()
          next[idx] = { ...prev[idx], is_connected: true }
          return next
        })
        setConnectedDevice((prev) => {
          if (prev && prev.udid === udid) return { ...prev, is_connected: true }
          return prev
        })
        setLostUdids((s) => { if (!s.has(udid)) return s; const n = new Set(s); n.delete(udid); return n })
      }
    })
  }, [subscribe, bumpWsGen])
  const [scanning, setScanning] = useState(false)
  const [wifiScanning, setWifiScanning] = useState(false)
  const [wifiDevices, setWifiDevices] = useState<WifiScanResult[]>([])

  // See `SCAN_COALESCE_MS` at module top — coalesces burst polls.
  const lastPollAtRef = useRef(0)

  const scan = useCallback(async (opts?: { poll?: boolean }) => {
    // Background polling path: silent (no spinner), and never triggers
    // auto-connect — polling is pure observation so the UI reflects
    // reality when WS events are missed.
    const isPoll = opts?.poll === true
    if (isPoll) {
      const dt = Date.now() - lastPollAtRef.current
      if (dt < SCAN_COALESCE_MS) return []
      lastPollAtRef.current = Date.now()
    }
    if (!isPoll) setScanning(true)
    try {
      const result = await listDevices()
      const list: DeviceInfo[] = Array.isArray(result) ? result : []
      // Skip the setState when every visible field matches — avoids
      // handing downstream useMemo/useEffect a new array reference for
      // no reason (a fresh `list` from `await listDevices()` is always
      // a distinct reference even when contents are identical).
      setDevices((prev) => deviceListEqual(prev, list) ? prev : list)
      const active = list.find((d) => d.is_connected) ?? null
      if (active) {
        setConnectedDevice(active)
      } else if (!isPoll && list.length === 1) {
        // Auto-connect when exactly one device is found (manual scan only).
        // Race protection: snapshot the WS event generation before the
        // await; if a `device_connected` / `device_disconnected` event
        // fires during the call, the WS subscriber has already updated
        // state and is authoritative — skip our refresh apply so we
        // don't clobber it.
        const wsGen = wsEventGenRef.current
        try {
          await connectDevice(list[0].udid)
          const refreshed = await listDevices()
          const rList: DeviceInfo[] = Array.isArray(refreshed) ? refreshed : []
          if (wsEventGenRef.current === wsGen) {
            setDevices((prev) => deviceListEqual(prev, rList) ? prev : rList)
            setConnectedDevice(rList.find((d) => d.udid === list[0].udid) ?? list[0])
          }
        } catch {
          if (wsEventGenRef.current === wsGen) setConnectedDevice(null)
        }
      } else {
        setConnectedDevice(null)
      }
      return list
    } catch (err) {
      devLog('Failed to scan devices:', err)
      return []
    } finally {
      if (!isPoll) setScanning(false)
    }
  }, [])

  // 30s background poll while the tab is visible, and an immediate
  // catch-up scan on hidden→visible transition. Belt-and-suspenders
  // for missed WS events (DVT tunnel drops, backend restart during
  // sleep, etc.) — without this, stale "connected" state persists
  // until the user tries to send a command.
  useEffect(() => {
    const POLL_INTERVAL_MS = 30_000
    let timer: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (timer != null) return
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          scan({ poll: true }).catch(() => { /* logged inside scan */ })
        }
      }, POLL_INTERVAL_MS)
    }
    const stopPolling = () => {
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scan({ poll: true }).catch(() => {})
        startPolling()
      } else {
        stopPolling()
      }
    }
    if (document.visibilityState === 'visible') {
      startPolling()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopPolling()
    }
  }, [scan])

  const connect = useCallback(
    async (udid: string) => {
      // Race protection: see `scan` auto-connect path. If WS already
      // told us about a state change during the await, skip the apply.
      const wsGen = wsEventGenRef.current
      try {
        await connectDevice(udid)
        const refreshed = await listDevices()
        const list: DeviceInfo[] = Array.isArray(refreshed) ? refreshed : []
        const active = list.find((d) => d.udid === udid) ?? null
        if (wsEventGenRef.current === wsGen) {
          setDevices((prev) => deviceListEqual(prev, list) ? prev : list)
          setConnectedDevice(active)
        }
        setLostUdids((s) => { if (!s.has(udid)) return s; const n = new Set(s); n.delete(udid); return n })
        return active
      } catch (err) {
        devLog('Failed to connect device:', err)
        throw err
      }
    },
    [],
  )

  const disconnect = useCallback(
    async (udid: string) => {
      const wsGen = wsEventGenRef.current
      try {
        await disconnectDevice(udid)
        const refreshed = await listDevices()
        const list: DeviceInfo[] = Array.isArray(refreshed) ? refreshed : []
        if (wsEventGenRef.current === wsGen) {
          setDevices((prev) => deviceListEqual(prev, list) ? prev : list)
          setConnectedDevice(null)
        }
      } catch (err) {
        devLog('Failed to disconnect device:', err)
        throw err
      }
    },
    [],
  )

  const forget = useCallback(
    async (udid: string) => {
      const wsGen = wsEventGenRef.current
      try {
        await forgetDevice(udid)
        const refreshed = await listDevices()
        const list: DeviceInfo[] = Array.isArray(refreshed) ? refreshed : []
        if (wsEventGenRef.current === wsGen) {
          setDevices((prev) => deviceListEqual(prev, list) ? prev : list)
          // Forgotten device cannot remain "primary"; clear if it was.
          setConnectedDevice((prev) => (prev && prev.udid === udid ? null : prev))
        }
      } catch (err) {
        devLog('Failed to forget device:', err)
        throw err
      }
    },
    [],
  )

  const connectWifi = useCallback(
    async (ip: string) => {
      try {
        const res = await wifiConnect(ip)
        const info: DeviceInfo = {
          udid: res.udid,
          name: res.name,
          ios_version: res.ios_version,
          connection_type: 'Network',
          is_connected: true,
        }
        setConnectedDevice(info)
        setDevices((prev) => {
          const filtered = prev.filter((d) => d.udid !== info.udid)
          return [...filtered, info]
        })
        return info
      } catch (err) {
        devLog('WiFi connect failed:', err)
        throw err
      }
    },
    [],
  )

  const scanWifi = useCallback(async () => {
    setWifiScanning(true)
    try {
      const results = await wifiScan()
      const list: WifiScanResult[] = Array.isArray(results) ? results : []
      setWifiDevices(list)
      return list
    } catch (err) {
      devLog('WiFi scan failed:', err)
      return []
    } finally {
      setWifiScanning(false)
    }
  }, [])

  const [tunnelStatus, setTunnelStatus] = useState<{ running: boolean; rsd_address?: string; rsd_port?: number }>({ running: false })

  const startWifiTunnel = useCallback(
    async (ip: string, port = DEFAULT_TUNNEL_PORT) => {
      try {
        const res = await wifiTunnelStartAndConnect(ip, port)
        const info: DeviceInfo = {
          udid: res.udid,
          name: res.name,
          ios_version: res.ios_version,
          connection_type: 'Network',
          is_connected: true,
        }
        setConnectedDevice(info)
        setDevices((prev) => {
          const filtered = prev.filter((d) => d.udid !== info.udid)
          return [...filtered, info]
        })
        setTunnelStatus({ running: true, rsd_address: res.rsd_address, rsd_port: res.rsd_port })
        return info
      } catch (err) {
        devLog('WiFi tunnel failed:', err)
        throw err
      }
    },
    [],
  )

  const checkTunnelStatus = useCallback(async () => {
    try {
      const res = await wifiTunnelStatus()
      setTunnelStatus(res)
      return res
    } catch {
      setTunnelStatus({ running: false })
      return { running: false }
    }
  }, [])

  const stopTunnel = useCallback(async () => {
    try {
      await wifiTunnelStop()
      setTunnelStatus({ running: false })
    } catch (err) {
      devLog('Failed to stop tunnel:', err)
    }
  }, [])

  // Group-mode derived state: every device in `devices` marked is_connected.
  // `primaryDevice` is the first one (ordering = connection order preserved
  // because scan() preserves backend list order).
  //
  // **New call sites should use `connectedDevices` / `primaryDevice`.**
  // `connectedDevice` is legacy and can be stale in multi-device flows
  // (e.g. when device B's `device_connected` arrives before device A's
  // `device_disconnected`, `connectedDevice` keeps pointing at A).
  const connectedDevices = useMemo(() => devices.filter((d) => d.is_connected), [devices])
  const primaryDevice = useMemo<DeviceInfo | null>(
    () => connectedDevices[0] ?? connectedDevice ?? null,
    [connectedDevices, connectedDevice],
  )

  // Stabilise the return object identity so consumers (DeviceContext
  // provider, App.tsx effect deps, useDeviceContext()) only re-run when
  // a listed value actually changes. Without this memo the Provider
  // value is a fresh object every render, and including `device` in
  // any useEffect dep array produces an infinite re-render loop.
  return useMemo(
    () => ({
      devices, connectedDevice, scanning, scan, connect, disconnect, forget,
      connectWifi, scanWifi, wifiScanning, wifiDevices,
      startWifiTunnel, checkTunnelStatus, stopTunnel, tunnelStatus,
      connectedDevices, primaryDevice,
      lostUdids,
    }),
    [
      devices, connectedDevice, scanning, scan, connect, disconnect, forget,
      connectWifi, scanWifi, wifiScanning, wifiDevices,
      startWifiTunnel, checkTunnelStatus, stopTunnel, tunnelStatus,
      connectedDevices, primaryDevice,
      lostUdids,
    ],
  )
}
