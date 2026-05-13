import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import * as api from '../services/api'
import {
  DEFAULT_RANDOM_WALK_RADIUS,
  DEFAULT_WP_GEN_COUNT,
  DEFAULT_WP_GEN_RADIUS,
} from '../lib/constants'
import { useCooldownSync } from '../hooks/useCooldownSync'
import { useWebSocketContext } from './WebSocketContext'
import { useToastContext } from './ToastContext'
import { useT } from '../i18n'

// SimSettingsContext owns local sim-related UI settings the user adjusts
// directly (waypoint generation, random-walk radius) plus the cooldown
// timer mirrored from the backend. Splitting these out of `SimContext`
// means a consumer like `RadiusRow` (only reads `randomWalkRadius`) no
// longer re-renders on every 10Hz position tick.

export interface SimSettingsContextValue {
  randomWalkRadius: number
  setRandomWalkRadius: (r: number) => void
  wpGenRadius: number
  setWpGenRadius: (r: number) => void
  wpGenCount: number
  setWpGenCount: (c: number) => void
  cooldown: number
  cooldownEnabled: boolean
  handleToggleCooldown: (enabled: boolean) => void
}

const SimSettingsContext = createContext<SimSettingsContextValue | null>(null)

interface SimSettingsProviderProps {
  children: ReactNode
}

export function SimSettingsProvider({ children }: SimSettingsProviderProps) {
  const t = useT()
  const { showToast } = useToastContext()
  const { subscribe } = useWebSocketContext()

  const [randomWalkRadius, setRandomWalkRadius] = useState(DEFAULT_RANDOM_WALK_RADIUS)
  const [wpGenRadius, setWpGenRadius] = useState(DEFAULT_WP_GEN_RADIUS)
  const [wpGenCount, setWpGenCount] = useState(DEFAULT_WP_GEN_COUNT)
  const [cooldown, setCooldown] = useState(0)
  const [cooldownEnabled, setCooldownEnabled] = useState(false)

  // Initial REST fetch + WS updates for the cooldown timer.
  useCooldownSync(subscribe, setCooldown, setCooldownEnabled)

  const handleToggleCooldown = useCallback((enabled: boolean) => {
    // Optimistic — flip immediately so the UI feels responsive. On backend
    // failure revert to the explicit prior value (negation of `enabled`)
    // rather than a functional `!v` setter; StrictMode runs the functional
    // form twice in dev and silently double-toggles back to the failed
    // state, masking the error.
    setCooldownEnabled(enabled)
    api.setCooldownEnabled(enabled).catch(() => {
      setCooldownEnabled(!enabled)
      showToast(t('err.cooldown_toggle_failed'))
    })
  }, [showToast, t])

  const value = useMemo<SimSettingsContextValue>(() => ({
    randomWalkRadius,
    setRandomWalkRadius,
    wpGenRadius,
    setWpGenRadius,
    wpGenCount,
    setWpGenCount,
    cooldown,
    cooldownEnabled,
    handleToggleCooldown,
  }), [
    randomWalkRadius,
    wpGenRadius,
    wpGenCount,
    cooldown,
    cooldownEnabled,
    handleToggleCooldown,
  ])

  return (
    <SimSettingsContext.Provider value={value}>
      {children}
    </SimSettingsContext.Provider>
  )
}

export function useSimSettings(): SimSettingsContextValue {
  const ctx = useContext(SimSettingsContext)
  if (!ctx) throw new Error('useSimSettings must be used inside SimSettingsProvider')
  return ctx
}
