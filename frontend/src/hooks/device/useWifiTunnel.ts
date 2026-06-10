/**
 * DVT-tunnel-over-WiFi sub-hook.
 *
 * Owns the `tunnelStatus` local state (running + RSD address) and the
 * three callbacks that read/write it: `startWifiTunnel`,
 * `checkTunnelStatus`, `stopTunnel`.
 *
 * `startWifiTunnel` also needs to publish the new device into the
 * parent `useDevice`'s `devices` / `connectedDevice` state, so the
 * parent passes those two setters in. They come from `useState` and are
 * stable across renders, so no ref indirection is needed (matches the
 * existing useCallback dep arrays of `[]`).
 */

import { useCallback, useState } from 'react'
import { DEFAULT_TUNNEL_PORT } from '../../lib/constants'
import {
  wifiTunnelStartAndConnect, wifiTunnelStatus, wifiTunnelStop,
} from '../../services/api'
import { devWarn } from '../../lib/dev-log'
import type { DeviceInfo } from './parsers'

export interface TunnelStatus {
  running: boolean
  rsd_address?: string
  rsd_port?: number
}

export interface WifiTunnelDeps {
  setDevices: React.Dispatch<React.SetStateAction<DeviceInfo[]>>
  setConnectedDevice: React.Dispatch<React.SetStateAction<DeviceInfo | null>>
}

export interface WifiTunnelApi {
  tunnelStatus: TunnelStatus
  startWifiTunnel: (ip: string, port?: number) => Promise<DeviceInfo>
  checkTunnelStatus: () => Promise<TunnelStatus>
  stopTunnel: () => Promise<void>
}

// Replace-in-place if the udid already exists, append otherwise. Preserves
// list ordering so WS-arrived ordering and WiFi-arrived ordering agree —
// the previous filter+append pattern always re-appended a known device to
// the end.
function upsertDevice(prev: DeviceInfo[], info: DeviceInfo): DeviceInfo[] {
  const idx = prev.findIndex((d) => d.udid === info.udid)
  if (idx === -1) return [...prev, info]
  const next = [...prev]
  next[idx] = info
  return next
}

export function useWifiTunnel({ setDevices, setConnectedDevice }: WifiTunnelDeps): WifiTunnelApi {
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus>({ running: false })

  const startWifiTunnel = useCallback(
    async (ip: string, port: number = DEFAULT_TUNNEL_PORT) => {
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
        setDevices((prev) => upsertDevice(prev, info))
        setTunnelStatus({ running: true, rsd_address: res.rsd_address, rsd_port: res.rsd_port })
        return info
      } catch (err) {
        devWarn('WiFi tunnel failed:', err)
        throw err
      }
    },
    [setConnectedDevice, setDevices],
  )

  const checkTunnelStatus = useCallback(async () => {
    try {
      const res = await wifiTunnelStatus()
      setTunnelStatus(res)
      return res
    } catch {
      const fallback: TunnelStatus = { running: false }
      setTunnelStatus(fallback)
      return fallback
    }
  }, [])

  const stopTunnel = useCallback(async () => {
    try {
      await wifiTunnelStop()
      setTunnelStatus({ running: false })
    } catch (err) {
      devWarn('Failed to stop tunnel:', err)
    }
  }, [])

  return {
    tunnelStatus,
    startWifiTunnel, checkTunnelStatus, stopTunnel,
  }
}
