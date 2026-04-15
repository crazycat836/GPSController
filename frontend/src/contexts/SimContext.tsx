import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useSimulation, SimMode, MoveMode } from '../hooks/useSimulation'
import type { WsSubscribe, FanoutOutcome } from '../hooks/useSimulation'
import { useJoystick } from '../hooks/useJoystick'
import * as api from '../services/api'
import { useDeviceContext } from './DeviceContext'
import { useToastContext } from './ToastContext'
import { useT } from '../i18n'

// Re-export for consumers
export { SimMode, MoveMode }

// Summarise a group fan-out result into a single toast string.
export function toastForFanout<T>(
  t: (k: any, v?: Record<string, string | number>) => string,
  action: string,
  outcome: FanoutOutcome<T>,
  devices: { udid: string }[],
): string {
  const total = outcome.ok.length + outcome.failed.length
  if (total === 0) return action
  if (outcome.failed.length === 0) return t('group.action_all_success', { action })
  if (outcome.ok.length === 0) return t('group.action_all_failed', { action })
  const statusFor = (udid: string) =>
    outcome.ok.some((o) => o.udid === udid) ? 'OK'
      : outcome.failed.find((f) => f.udid === udid)?.reason ?? 'error'
  return t('group.action_partial', {
    action,
    aStatus: devices[0] ? statusFor(devices[0].udid) : '-',
    bStatus: devices[1] ? statusFor(devices[1].udid) : '-',
  })
}

export const SPEED_MAP: Record<MoveMode, number> = {
  walking: 5,
  running: 10,
  driving: 40,
}

interface SimContextValue {
  // From useSimulation - pass through everything
  sim: ReturnType<typeof useSimulation>
  // From useJoystick
  joystick: ReturnType<typeof useJoystick>
  // Local state
  randomWalkRadius: number
  setRandomWalkRadius: (r: number) => void
  wpGenRadius: number
  setWpGenRadius: (r: number) => void
  wpGenCount: number
  setWpGenCount: (c: number) => void
  cooldown: number
  cooldownEnabled: boolean
  // Handlers
  handleTeleport: (lat: number, lng: number) => void
  handleNavigate: (lat: number, lng: number) => void
  handleStart: () => void
  handleStop: () => void
  handlePause: () => void
  handleResume: () => void
  handleRestore: () => void
  handleApplySpeed: () => Promise<void>
  handleToggleCooldown: (enabled: boolean) => void
  handleAddWaypoint: (lat: number, lng: number) => void
  handleClearWaypoints: () => void
  handleRemoveWaypoint: (index: number) => void
  handleGenerateRandomWaypoints: () => void
  handleGenerateAllRandom: () => void
  handleOpenLog: () => void
  handleMapClick: (lat: number, lng: number) => void
  // Derived
  displaySpeed: number | string
  isRunning: boolean
  isPaused: boolean
  currentPos: { lat: number; lng: number } | null
  destPos: { lat: number; lng: number } | null
  speed: number
}

const SimContext = createContext<SimContextValue | null>(null)

interface SimProviderProps {
  subscribe?: WsSubscribe
  sendMessage: (type: string, data?: any) => void
  children: React.ReactNode
}

export function SimProvider({ subscribe, sendMessage, children }: SimProviderProps) {
  const t = useT()
  const device = useDeviceContext()
  const { showToast } = useToastContext()
  const sim = useSimulation(subscribe)
  const joystick = useJoystick(sendMessage, sim.mode === SimMode.Joystick)

  const [cooldown, setCooldown] = useState(0)
  const [cooldownEnabled, setCooldownEnabled] = useState(false)
  const [randomWalkRadius, setRandomWalkRadius] = useState(500)
  const [wpGenRadius, setWpGenRadius] = useState(300)
  const [wpGenCount, setWpGenCount] = useState(5)

  // --- Handlers ---

  const handleRestore = useCallback(async () => {
    showToast(t('status.restore_in_progress'), 10000)
    const startedAt = Date.now()
    try {
      const udids = device.connectedDevices.map((d) => d.udid)
      if (udids.length >= 2) {
        const outcome = await sim.restoreAll(udids)
        if (outcome.failed.length > 0 && outcome.ok.length === 0) {
          throw new Error(outcome.failed[0]?.reason ?? 'restore failed')
        }
      } else {
        await sim.restore()
      }
      const elapsed = Date.now() - startedAt
      if (elapsed < 1200) {
        await new Promise((r) => setTimeout(r, 1200 - elapsed))
      }
      showToast(t('status.restore_success_wait'))
    } catch {
      showToast(t('status.restore_failed'))
    }
  }, [showToast, t, sim, device])

  const generateWaypoints = useCallback((radius: number, count: number) => {
    if (!sim.currentPosition) {
      showToast(t('toast.no_position_random'))
      return
    }
    const { lat, lng } = sim.currentPosition
    const latScale = 111320
    const lngScale = 111320 * Math.cos((lat * Math.PI) / 180)

    type Pt = { lat: number; lng: number; theta?: number }
    const pts: Pt[] = []
    for (let i = 0; i < count; i++) {
      const r = radius * Math.sqrt(Math.random())
      const theta = Math.random() * 2 * Math.PI
      pts.push({
        lat: lat + (r * Math.cos(theta)) / latScale,
        lng: lng + (r * Math.sin(theta)) / lngScale,
        theta,
      })
    }

    const remaining = [...pts]
    const ordered: Pt[] = []
    let cx = lat, cy = lng
    while (remaining.length) {
      let bestIdx = 0, bestD = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const dx = (remaining[i].lat - cx) * latScale
        const dy = (remaining[i].lng - cy) * lngScale
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; bestIdx = i }
      }
      const [next] = remaining.splice(bestIdx, 1)
      ordered.push(next)
      cx = next.lat; cy = next.lng
    }

    sim.setWaypoints([
      { lat, lng },
      ...ordered.map(({ lat, lng }) => ({ lat, lng })),
    ])
  }, [sim, t])

  const handleGenerateRandomWaypoints = useCallback(() => {
    generateWaypoints(wpGenRadius, wpGenCount)
  }, [generateWaypoints, wpGenRadius, wpGenCount])

  const handleGenerateAllRandom = useCallback(() => {
    const radius = Math.floor(50 + Math.random() * 950)
    const count = Math.floor(3 + Math.random() * 8)
    setWpGenRadius(radius)
    setWpGenCount(count)
    generateWaypoints(radius, count)
  }, [generateWaypoints])

  const handleToggleCooldown = useCallback((enabled: boolean) => {
    setCooldownEnabled(enabled)
    api.setCooldownEnabled(enabled).catch(() => setCooldownEnabled((v) => !v))
  }, [])

  const handleMapClick = useCallback((_lat: number, _lng: number) => {
    // Just set as destination for now
  }, [])

  const handleTeleport = useCallback(async (lat: number, lng: number) => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (udids.length >= 2) {
      sim.setCurrentPosition({ lat, lng })
      const outcome = await sim.teleportAll(udids, lat, lng)
      showToast(toastForFanout(t, t('mode.teleport'), outcome, device.connectedDevices))
    } else {
      sim.teleport(lat, lng)
    }
  }, [sim, device, t, showToast])

  const handleNavigate = useCallback(async (lat: number, lng: number) => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (udids.length >= 2) {
      const outcome = await sim.navigateAll(udids, lat, lng)
      showToast(toastForFanout(t, t('mode.navigate'), outcome, device.connectedDevices))
    } else {
      sim.navigate(lat, lng)
    }
  }, [sim, device, t, showToast])

  const handleAddWaypoint = useCallback((lat: number, lng: number) => {
    sim.setWaypoints((prev: any[]) => {
      if (prev.length === 0 && sim.currentPosition) {
        return [
          { lat: sim.currentPosition.lat, lng: sim.currentPosition.lng },
          { lat, lng },
        ]
      }
      return [...prev, { lat, lng }]
    })
  }, [sim])

  const handleClearWaypoints = useCallback(() => {
    sim.setWaypoints([])
  }, [sim])

  const handleRemoveWaypoint = useCallback((index: number) => {
    sim.setWaypoints((prev: any[]) => prev.filter((_: any, i: number) => i !== index))
  }, [sim])

  const handleStartWaypointRoute = useCallback(async () => {
    const route = sim.waypoints
    if (route.length < 2) {
      showToast(t('toast.no_waypoints'))
      return
    }
    const udids = device.connectedDevices.map((d) => d.udid)
    if (sim.mode === SimMode.Loop) {
      if (udids.length >= 2) {
        const outcome = await sim.startLoopAll(udids, route)
        showToast(toastForFanout(t, t('mode.loop'), outcome, device.connectedDevices))
      } else {
        sim.startLoop(route)
      }
    } else if (sim.mode === SimMode.MultiStop) {
      if (udids.length >= 2) {
        const outcome = await sim.multiStopAll(udids, route, 0, false)
        showToast(toastForFanout(t, t('mode.multi_stop'), outcome, device.connectedDevices))
      } else {
        sim.multiStop(route, 0, false)
      }
    }
  }, [sim, device, showToast, t])

  const handleStart = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (sim.mode === SimMode.Joystick) {
      if (udids.length >= 2) {
        const outcome = await sim.joystickStartAll(udids)
        showToast(toastForFanout(t, t('mode.joystick'), outcome, device.connectedDevices))
      } else {
        sim.joystickStart()
      }
    } else if (sim.mode === SimMode.RandomWalk) {
      if (!sim.currentPosition) {
        showToast(t('toast.no_position_random'))
        return
      }
      if (udids.length >= 2) {
        const outcome = await sim.randomWalkAll(udids, sim.currentPosition, randomWalkRadius)
        showToast(toastForFanout(t, t('mode.random_walk'), outcome, device.connectedDevices))
      } else {
        sim.randomWalk(sim.currentPosition, randomWalkRadius)
      }
    } else if (sim.mode === SimMode.Loop || sim.mode === SimMode.MultiStop) {
      handleStartWaypointRoute()
    }
  }, [sim, device, randomWalkRadius, handleStartWaypointRoute, showToast, t])

  const handleStop = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (sim.mode === SimMode.Joystick && udids.length >= 2) {
      const outcome = await sim.joystickStopAll(udids)
      showToast(toastForFanout(t, t('mode.joystick'), outcome, device.connectedDevices))
      return
    }
    if (udids.length >= 2) {
      const outcome = await sim.stopAll(udids)
      showToast(toastForFanout(t, 'stop', outcome, device.connectedDevices))
    } else {
      sim.stop()
    }
  }, [sim, device, t, showToast])

  const handleApplySpeed = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    try {
      if (udids.length >= 2) {
        const outcome = await sim.applySpeedAll(udids)
        showToast(toastForFanout(t, t('panel.apply_speed_success'), outcome, device.connectedDevices))
      } else {
        await sim.applySpeed()
        showToast(t('panel.apply_speed_success'))
      }
    } catch (err: unknown) {
      showToast(t('panel.apply_speed_failed') + (err instanceof Error ? `: ${err.message}` : ''))
    }
  }, [sim, device, showToast, t])

  const handlePause = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (udids.length >= 2) {
      const outcome = await sim.pauseAll(udids)
      showToast(toastForFanout(t, 'pause', outcome, device.connectedDevices))
    } else {
      sim.pause()
    }
  }, [sim, device, t, showToast])

  const handleResume = useCallback(async () => {
    const udids = device.connectedDevices.map((d) => d.udid)
    if (udids.length >= 2) {
      const outcome = await sim.resumeAll(udids)
      showToast(toastForFanout(t, 'resume', outcome, device.connectedDevices))
    } else {
      sim.resume()
    }
  }, [sim, device, t, showToast])

  const handleOpenLog = useCallback(async () => {
    try {
      await api.openLogFolder()
    } catch (err: unknown) {
      showToast(t('status.open_log_failed') + (err instanceof Error ? `: ${err.message}` : ''))
    }
  }, [showToast, t])

  // --- Effects ---

  // Poll cooldown
  useEffect(() => {
    if (!subscribe) return
    const id = setInterval(() => {
      api.getCooldownStatus().then((s: any) => {
        setCooldown(s.remaining_seconds ?? 0)
        if (typeof s.enabled === 'boolean') setCooldownEnabled(s.enabled)
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(id)
  }, [subscribe])

  // --- Derived values ---

  const currentPos = sim.currentPosition
    ? { lat: sim.currentPosition.lat, lng: sim.currentPosition.lng }
    : null

  const destPos = sim.destination
    ? { lat: sim.destination.lat, lng: sim.destination.lng }
    : null

  const speed = SPEED_MAP[sim.moveMode] || 5

  const fmtSpeedFromInputs = (kmh: number | null, lo: number | null, hi: number | null): number | string => {
    if (lo != null && hi != null) return `${Math.min(lo, hi)}~${Math.max(lo, hi)}`
    if (kmh != null) return kmh
    return speed
  }
  const displaySpeed: number | string = sim.status.running && sim.effectiveSpeed
    ? fmtSpeedFromInputs(sim.effectiveSpeed.kmh, sim.effectiveSpeed.min, sim.effectiveSpeed.max)
    : fmtSpeedFromInputs(sim.customSpeedKmh, sim.speedMinKmh, sim.speedMaxKmh)

  const isRunning = sim.status.running
  const isPaused = sim.status.paused

  const value: SimContextValue = {
    sim,
    joystick,
    randomWalkRadius,
    setRandomWalkRadius,
    wpGenRadius,
    setWpGenRadius,
    wpGenCount,
    setWpGenCount,
    cooldown,
    cooldownEnabled,
    handleTeleport,
    handleNavigate,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    handleRestore,
    handleApplySpeed,
    handleToggleCooldown,
    handleAddWaypoint,
    handleClearWaypoints,
    handleRemoveWaypoint,
    handleGenerateRandomWaypoints,
    handleGenerateAllRandom,
    handleOpenLog,
    handleMapClick,
    displaySpeed,
    isRunning,
    isPaused,
    currentPos,
    destPos,
    speed,
  }

  return (
    <SimContext.Provider value={value}>
      {children}
    </SimContext.Provider>
  )
}

export function useSimContext() {
  const ctx = useContext(SimContext)
  if (!ctx) throw new Error('useSimContext must be used within SimProvider')
  return ctx
}
