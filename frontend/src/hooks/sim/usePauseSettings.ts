/**
 * Per-mode pause settings (Loop / MultiStop / RandomWalk), persisted in
 * localStorage so the user's tuned `enabled / min / max` triplet survives
 * reload.
 *
 * Defaults match the backend's DEFAULT_PAUSE_* constants so a fresh
 * install behaves the same on both sides.
 */

import { useState } from 'react'
import { STORAGE_KEYS } from '../../lib/storage-keys'

export interface PauseSetting {
  enabled: boolean
  min: number
  max: number
}

const DEFAULT_PAUSE: PauseSetting = { enabled: true, min: 5, max: 20 }

function loadPause(key: string): PauseSetting {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULT_PAUSE
    const p = JSON.parse(raw)
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_PAUSE.enabled,
      min: typeof p.min === 'number' ? p.min : DEFAULT_PAUSE.min,
      max: typeof p.max === 'number' ? p.max : DEFAULT_PAUSE.max,
    }
  } catch {
    return DEFAULT_PAUSE
  }
}

function savePause(key: string, v: PauseSetting): void {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
}

export interface UsePauseSettingsValue {
  pauseLoop: PauseSetting
  pauseMultiStop: PauseSetting
  pauseRandomWalk: PauseSetting
  setPauseLoop: (v: PauseSetting) => void
  setPauseMultiStop: (v: PauseSetting) => void
  setPauseRandomWalk: (v: PauseSetting) => void
}

export function usePauseSettings(): UsePauseSettingsValue {
  const [pauseLoop, setPauseLoopRaw] = useState<PauseSetting>(() => loadPause(STORAGE_KEYS.pauseLoop))
  const [pauseMultiStop, setPauseMultiStopRaw] = useState<PauseSetting>(() => loadPause(STORAGE_KEYS.pauseMultiStop))
  const [pauseRandomWalk, setPauseRandomWalkRaw] = useState<PauseSetting>(() => loadPause(STORAGE_KEYS.pauseRandomWalk))

  const setPauseLoop = (v: PauseSetting) => { setPauseLoopRaw(v); savePause(STORAGE_KEYS.pauseLoop, v) }
  const setPauseMultiStop = (v: PauseSetting) => { setPauseMultiStopRaw(v); savePause(STORAGE_KEYS.pauseMultiStop, v) }
  const setPauseRandomWalk = (v: PauseSetting) => { setPauseRandomWalkRaw(v); savePause(STORAGE_KEYS.pauseRandomWalk, v) }

  return { pauseLoop, pauseMultiStop, pauseRandomWalk, setPauseLoop, setPauseMultiStop, setPauseRandomWalk }
}

/** Global "straight-line path" toggle, persisted as `'1'`/`'0'`. */
export function useStraightLineToggle(): [boolean, (v: boolean) => void] {
  const [value, setValueRaw] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.straightLine) === '1' } catch { return false }
  })
  const setValue = (v: boolean) => {
    setValueRaw(v)
    try { localStorage.setItem(STORAGE_KEYS.straightLine, v ? '1' : '0') } catch { /* ignore */ }
  }
  return [value, setValue]
}
