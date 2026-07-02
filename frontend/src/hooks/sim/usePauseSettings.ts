/**
 * Per-mode pause settings (Loop / MultiStop / RandomWalk), persisted in
 * localStorage so the user's tuned `enabled / min / max` triplet survives
 * reload.
 *
 * Defaults match the backend's DEFAULT_PAUSE_* constants so a fresh
 * install behaves the same on both sides.
 */

import { useCallback, useState } from 'react'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import { DEFAULT_PAUSE } from '../../lib/constants'
import { readLS, writeLS, readJSON, writeJSON } from '../../lib/local-storage'

export interface PauseSetting {
  enabled: boolean
  min: number
  max: number
}

function loadPause(key: string): PauseSetting {
  const p = readJSON(key) as Record<string, unknown> | null
  if (p == null) return DEFAULT_PAUSE
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_PAUSE.enabled,
    min: typeof p.min === 'number' ? p.min : DEFAULT_PAUSE.min,
    max: typeof p.max === 'number' ? p.max : DEFAULT_PAUSE.max,
  }
}

function savePause(key: string, v: PauseSetting): void {
  writeJSON(key, v)
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

  // useCallback so the setter identities stay stable across renders — they
  // are surfaced through SimContext's *stable* actions slice, which must not
  // invalidate on every provider render (that would re-render action-only
  // consumers on position ticks). The raw setters + module-level savePause
  // are all stable, so [] deps are correct.
  const setPauseLoop = useCallback((v: PauseSetting) => { setPauseLoopRaw(v); savePause(STORAGE_KEYS.pauseLoop, v) }, [])
  const setPauseMultiStop = useCallback((v: PauseSetting) => { setPauseMultiStopRaw(v); savePause(STORAGE_KEYS.pauseMultiStop, v) }, [])
  const setPauseRandomWalk = useCallback((v: PauseSetting) => { setPauseRandomWalkRaw(v); savePause(STORAGE_KEYS.pauseRandomWalk, v) }, [])

  return { pauseLoop, pauseMultiStop, pauseRandomWalk, setPauseLoop, setPauseMultiStop, setPauseRandomWalk }
}

/** Global "straight-line path" toggle, persisted as `'1'`/`'0'`. */
export function useStraightLineToggle(): [boolean, (v: boolean) => void] {
  const [value, setValueRaw] = useState<boolean>(
    () => readLS(STORAGE_KEYS.straightLine) === '1',
  )
  const setValue = (v: boolean) => {
    setValueRaw(v)
    writeLS(STORAGE_KEYS.straightLine, v ? '1' : '0')
  }
  return [value, setValue]
}
