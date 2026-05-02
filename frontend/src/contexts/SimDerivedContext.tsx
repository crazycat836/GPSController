import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { SPEED_MAP, useSimContext } from './SimContext'

// A focused slice of SimContext for read-only consumers (route cards,
// pause-resume pill, action gating). The 5 fields here also live on
// SimContext.value for backward compat with non-migrated consumers.
export interface SimDerivedContextValue {
  currentPos: { lat: number; lng: number } | null
  destPos: { lat: number; lng: number } | null
  // numeric km/h when single, "min~max" range string when bounded
  displaySpeed: number | string
  isRunning: boolean
  isPaused: boolean
}

const SimDerivedContext = createContext<SimDerivedContextValue | null>(null)

interface SimDerivedProviderProps {
  children: ReactNode
}

export function SimDerivedProvider({ children }: SimDerivedProviderProps) {
  const { sim } = useSimContext()

  const currentPos = useMemo(
    () => sim.currentPosition ? { lat: sim.currentPosition.lat, lng: sim.currentPosition.lng } : null,
    [sim.currentPosition?.lat, sim.currentPosition?.lng],
  )

  const destPos = useMemo(
    () => sim.destination ? { lat: sim.destination.lat, lng: sim.destination.lng } : null,
    [sim.destination?.lat, sim.destination?.lng],
  )

  const isRunning = sim.status.running
  const isPaused = sim.status.paused

  const speed = SPEED_MAP[sim.moveMode] || 5

  const displaySpeed: number | string = useMemo(() => {
    const fmt = (kmh: number | null, lo: number | null, hi: number | null): number | string => {
      if (lo != null && hi != null) return `${Math.min(lo, hi)}~${Math.max(lo, hi)}`
      if (kmh != null) return kmh
      return speed
    }
    return sim.status.running && sim.effectiveSpeed
      ? fmt(sim.effectiveSpeed.kmh, sim.effectiveSpeed.min, sim.effectiveSpeed.max)
      : fmt(sim.customSpeedKmh, sim.speedMinKmh, sim.speedMaxKmh)
  }, [
    sim.status.running,
    sim.effectiveSpeed?.kmh,
    sim.effectiveSpeed?.min,
    sim.effectiveSpeed?.max,
    sim.customSpeedKmh,
    sim.speedMinKmh,
    sim.speedMaxKmh,
    speed,
  ])

  const value = useMemo<SimDerivedContextValue>(
    () => ({ currentPos, destPos, displaySpeed, isRunning, isPaused }),
    [currentPos, destPos, displaySpeed, isRunning, isPaused],
  )

  return <SimDerivedContext.Provider value={value}>{children}</SimDerivedContext.Provider>
}

export function useSimDerived(): SimDerivedContextValue {
  const ctx = useContext(SimDerivedContext)
  if (!ctx) throw new Error('useSimDerived must be used inside SimDerivedProvider')
  return ctx
}
