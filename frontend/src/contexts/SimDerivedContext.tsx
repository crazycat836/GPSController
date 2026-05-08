import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useSimContext } from './SimContext'
import { pickDisplaySpeed, toLatLng } from '../lib/sim-derive'

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

  // Derivations live in `lib/sim-derive.ts` so this provider and
  // `SimContext` agree on every formula (toLatLng, pickDisplaySpeed) by
  // construction. No more "must stay in sync" comments.
  const currentPos = useMemo(
    () => toLatLng(sim.currentPosition),
    [sim.currentPosition?.lat, sim.currentPosition?.lng],
  )

  const destPos = useMemo(
    () => toLatLng(sim.destination),
    [sim.destination?.lat, sim.destination?.lng],
  )

  const isRunning = sim.status.running
  const isPaused = sim.status.paused

  const displaySpeed: number | string = useMemo(
    () => pickDisplaySpeed({
      running: sim.status.running,
      moveMode: sim.moveMode,
      effectiveSpeed: sim.effectiveSpeed,
      customSpeedKmh: sim.customSpeedKmh,
      speedMinKmh: sim.speedMinKmh,
      speedMaxKmh: sim.speedMaxKmh,
    }),
    [
      sim.status.running,
      sim.moveMode,
      sim.effectiveSpeed?.kmh,
      sim.effectiveSpeed?.min,
      sim.effectiveSpeed?.max,
      sim.customSpeedKmh,
      sim.speedMinKmh,
      sim.speedMaxKmh,
    ],
  )

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
