/**
 * Pure parsers + types for the device hooks.
 *
 * Zero React, zero state. The backend emits a small stable subset of
 * udid-tagged WS events; these guards narrow the `unknown`-typed
 * `WsMessage.data` once at the entry point so the rest of the
 * subscriber reads payloads as plain TypeScript.
 *
 * Reason for not using `as any` here: silent payload drift (e.g.
 * backend renaming `udid` → `device_id`) was previously invisible to
 * TS — these guards make such drift surface at the parse boundary.
 */

import type { WsMessage } from '../useWebSocket'

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

export interface DeviceConnectedPayload {
  udid: string
  name?: string
  ios_version?: string
  connection_type?: string
}

export interface DeviceDisconnectedPayload {
  udid?: string
  udids?: readonly string[]
  reason?: string
}

export interface DeviceReconnectedPayload {
  udid: string
}

export interface DeviceSnapshotEntry {
  udid: string
  name?: string
  ios_version?: string
  connection_type?: string
}

export interface DeviceSnapshotPayload {
  devices: readonly DeviceSnapshotEntry[]
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

export function parseDeviceConnected(data: unknown): DeviceConnectedPayload | null {
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

export function parseDeviceDisconnected(data: unknown): DeviceDisconnectedPayload {
  const obj = asObject(data) ?? {}
  return {
    udid: asString(obj.udid),
    udids: asStringArray(obj.udids),
    reason: asString(obj.reason),
  }
}

export function parseDeviceReconnected(data: unknown): DeviceReconnectedPayload | null {
  const obj = asObject(data)
  if (!obj) return null
  const udid = asString(obj.udid)
  if (!udid) return null
  return { udid }
}

export function parseDeviceSnapshot(data: unknown): DeviceSnapshotPayload | null {
  const obj = asObject(data)
  if (!obj) return null
  const raw = obj.devices
  if (!Array.isArray(raw)) return null
  const devices: DeviceSnapshotEntry[] = []
  for (const entry of raw) {
    const e = asObject(entry)
    if (!e) continue
    const udid = asString(e.udid)
    if (!udid) continue
    devices.push({
      udid,
      name: asString(e.name),
      ios_version: asString(e.ios_version),
      connection_type: asString(e.connection_type),
    })
  }
  return { devices }
}

export function deviceListEqual(a: readonly DeviceInfo[], b: readonly DeviceInfo[]): boolean {
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
