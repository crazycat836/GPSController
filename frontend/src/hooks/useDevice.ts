import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  listDevices, connectDevice, disconnectDevice, forgetDevice,
  clearAutoReconnectBlocks,
} from '../services/api'
import { devWarn } from '../lib/dev-log'
import { deviceListEqual } from './device/parsers'
import type { DeviceInfo, WsSubscribe } from './device/parsers'
import { useDeviceWs } from './device/useDeviceWs'
import type { DeviceLastDisconnect } from './device/useDeviceWs'
import { useWifiTunnel } from './device/useWifiTunnel'

export type { DeviceInfo, WifiScanResult, WsSubscribe, DeviceLostCause } from './device/parsers'
export type { DeviceLastDisconnect } from './device/useDeviceWs'

// Coalesce burst scans (visibility-change + WS-reconnect debounce can
// both fire within ~200ms). When `poll: true` AND another poll ran
// within SCAN_COALESCE_MS, skip — manual scans always go through.
const SCAN_COALESCE_MS = 1500

// Device-side errors are logged via `devWarn` (console.warn) instead of
// console.error so informational "scan failed / connect failed" lines
// don't light up red + trigger the DevTools error overlay — they're
// recoverable, not faults.

export function useDevice(subscribe?: WsSubscribe) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [connectedDevice, setConnectedDevice] = useState<DeviceInfo | null>(null)
  // UDIDs that were connected and then lost involuntarily (DVT reconnect
  // exhausted, USB unplug, WiFi tunnel died). Used by DeviceDrawer to
  // distinguish "just disconnected" from "never connected / Ready" — both
  // share is_connected=false but the former deserves a red "已斷線" pill.
  // Cleared when the UDID reappears connected, or on a fresh scan.
  const [lostUdids, setLostUdids] = useState<Set<string>>(() => new Set())
  // Last involuntary disconnect — drives the cause-specific toast in
  // App.tsx. Independent of `lostUdids`; same trigger but carries the
  // root-cause label classified by the backend.
  const [lastDisconnect, setLastDisconnect] = useState<DeviceLastDisconnect | null>(null)

  // Bumped every time a WS-driven state change is applied (connected /
  // disconnected / reconnected). Used by REST flows (scan/connect/
  // disconnect) to detect "did a WS event race past me while I was
  // awaiting?" — if so, the WS event is authoritative and we skip the
  // post-await `setDevices` apply that would clobber it. See the
  // auto-connect path in `scan` for the canonical use.
  const wsEventGenRef = useRef(0)
  const bumpWsGen = useCallback(() => { wsEventGenRef.current += 1 }, [])

  // Frontend boot — drop any "user-disconnected" marks from the prior
  // session so a fresh page treats every paired device as eligible
  // for auto-reconnect again. Endpoint is idempotent + fire-and-forget,
  // so the StrictMode double-mount in dev is harmless.
  useEffect(() => {
    clearAutoReconnectBlocks().catch((err) => devWarn('clearAutoReconnectBlocks failed', err))
  }, [])

  useDeviceWs(subscribe, {
    setDevices, setConnectedDevice, setLostUdids, setLastDisconnect, bumpWsGen,
  })

  const wifi = useWifiTunnel({ setDevices, setConnectedDevice })

  const [scanning, setScanning] = useState(false)

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
      devWarn('Failed to scan devices:', err)
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
        devWarn('Failed to connect device:', err)
        throw err
      }
    },
    [],
  )

  const disconnect = useCallback(
    async (udid: string) => {
      try {
        await disconnectDevice(udid)
        // The backend broadcasts `device_disconnected` (see WS handler
        // above) which updates both `devices` and `connectedDevice` —
        // no need to re-list. The WS handler is also race-safe via
        // bumpWsGen.
      } catch (err) {
        devWarn('Failed to disconnect device:', err)
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
        devWarn('Failed to forget device:', err)
        throw err
      }
    },
    [],
  )

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
  const {
    wifiScanning, wifiDevices, tunnelStatus,
    scanWifi, connectWifi, startWifiTunnel, checkTunnelStatus, stopTunnel,
  } = wifi
  return useMemo(
    () => ({
      devices, connectedDevice, scanning, scan, connect, disconnect, forget,
      connectWifi, scanWifi, wifiScanning, wifiDevices,
      startWifiTunnel, checkTunnelStatus, stopTunnel, tunnelStatus,
      connectedDevices, primaryDevice,
      lostUdids, lastDisconnect,
    }),
    [
      devices, connectedDevice, scanning, scan, connect, disconnect, forget,
      connectWifi, scanWifi, wifiScanning, wifiDevices,
      startWifiTunnel, checkTunnelStatus, stopTunnel, tunnelStatus,
      connectedDevices, primaryDevice,
      lostUdids, lastDisconnect,
    ],
  )
}
