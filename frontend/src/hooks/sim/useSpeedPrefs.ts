/**
 * Speed preference persistence — the user's last-selected movement speed
 * (mode + any manual override) is persisted in localStorage so a relaunch
 * reuses it instead of resetting to Walking.
 *
 * Owns the four speed atoms (`moveMode`, `customSpeedKmh`, `speedMinKmh`,
 * `speedMaxKmh`) and the effect that writes them back on every change.
 * `useSimulation` re-exposes the atoms + setters unchanged.
 *
 * `MoveMode` lives here (rather than in `useSimulation.ts`) so the
 * localStorage load can validate against the enum without a circular
 * import back through `useSimulation`.
 */

import { useState, useEffect } from 'react'
import { STORAGE_KEYS } from '../../lib/storage-keys'

export enum MoveMode {
  Walking = 'walking',
  Running = 'running',
  Driving = 'driving',
}

export interface SpeedPrefs {
  moveMode: MoveMode
  customSpeedKmh: number | null
  speedMinKmh: number | null
  speedMaxKmh: number | null
}

const DEFAULT_SPEED_PREFS: SpeedPrefs = {
  moveMode: MoveMode.Walking,
  customSpeedKmh: null,
  speedMinKmh: null,
  speedMaxKmh: null,
}

function isMoveMode(v: unknown): v is MoveMode {
  return v === MoveMode.Walking || v === MoveMode.Running || v === MoveMode.Driving
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function loadSpeedPrefs(): SpeedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.speedPrefs)
    if (!raw) return DEFAULT_SPEED_PREFS
    const p = JSON.parse(raw) as Record<string, unknown>
    return {
      moveMode: isMoveMode(p.moveMode) ? p.moveMode : DEFAULT_SPEED_PREFS.moveMode,
      customSpeedKmh: numOrNull(p.customSpeedKmh),
      speedMinKmh: numOrNull(p.speedMinKmh),
      speedMaxKmh: numOrNull(p.speedMaxKmh),
    }
  } catch {
    return DEFAULT_SPEED_PREFS
  }
}

function saveSpeedPrefs(p: SpeedPrefs): void {
  try { localStorage.setItem(STORAGE_KEYS.speedPrefs, JSON.stringify(p)) } catch { /* ignore */ }
}

export interface UseSpeedPrefsValue {
  moveMode: MoveMode
  setMoveMode: React.Dispatch<React.SetStateAction<MoveMode>>
  customSpeedKmh: number | null
  setCustomSpeedKmh: React.Dispatch<React.SetStateAction<number | null>>
  speedMinKmh: number | null
  setSpeedMinKmh: React.Dispatch<React.SetStateAction<number | null>>
  speedMaxKmh: number | null
  setSpeedMaxKmh: React.Dispatch<React.SetStateAction<number | null>>
}

export function useSpeedPrefs(): UseSpeedPrefsValue {
  // Speed prefs lazy-load from localStorage so the last-selected speed is
  // reused on relaunch. A single one-shot read seeds all four fields below.
  // `useRef(loadSpeedPrefs())` would re-invoke the localStorage read on every
  // render (the arg is evaluated each time, even though useRef keeps the
  // first); a lazy state initialiser runs it exactly once.
  const [initialSpeedPrefs] = useState<SpeedPrefs>(loadSpeedPrefs)
  const [moveMode, setMoveMode] = useState<MoveMode>(initialSpeedPrefs.moveMode)
  const [customSpeedKmh, setCustomSpeedKmh] = useState<number | null>(initialSpeedPrefs.customSpeedKmh)
  const [speedMinKmh, setSpeedMinKmh] = useState<number | null>(initialSpeedPrefs.speedMinKmh)
  const [speedMaxKmh, setSpeedMaxKmh] = useState<number | null>(initialSpeedPrefs.speedMaxKmh)

  // Persist the speed selection whenever any of the four fields changes so
  // the next launch reuses it. Cheap JSON write; no throttle needed since
  // these change only on explicit user input, not on the 10 Hz nav stream.
  useEffect(() => {
    saveSpeedPrefs({ moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh })
  }, [moveMode, customSpeedKmh, speedMinKmh, speedMaxKmh])

  return {
    moveMode,
    setMoveMode,
    customSpeedKmh,
    setCustomSpeedKmh,
    speedMinKmh,
    setSpeedMinKmh,
    speedMaxKmh,
    setSpeedMaxKmh,
  }
}
