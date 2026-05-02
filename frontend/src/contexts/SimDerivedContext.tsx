import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { SPEED_MAP, useSimContext } from './SimContext'

// Cheap-derived projections of `SimContext.value`. Lives in its own
// context so consumers that read only these fields (route cards,
// pause-resume pill, action gating) can subscribe to a more stable
// slice and skip re-renders triggered by every WS tick on the parent.
//
// The five values here are intentionally duplicates of the same five
// fields exposed on SimContext.value — non-migrated consumers continue
// to read them from there. The migration is incremental.
export interface SimDerivedContextValue {
  currentPos: { lat: number; lng: number } | null
  destPos: { lat: number; lng: number } | null
  // `number | string` mirrors SimContext: numeric km/h when single,
  // "min~max" range string when bounded.
  displaySpeed: number | string
  isRunning: boolean
  isPaused: boolean
}

const SimDerivedContext = createContext<SimDerivedContextValue | null>(null)

interface SimDerivedProviderProps {
  children: ReactNode
}

// Computations are copied verbatim from SimContext (lines ~658-695)
// so both contexts produce identical values. The wrapping `value`
// useMemo is keyed only on the five derived fields, so its identity
// stays stable across WS ticks that don't change any of them.
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

  // Mirrors `SimContext.speed` — preset for the active move mode (km/h).
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
