import React from 'react'
import { Play, Square, Pause, ArrowRight } from 'lucide-react'
import { useSimContext } from '../../../contexts/SimContext'
import { useSimDerived } from '../../../contexts/SimDerivedContext'
import { SimMode } from '../../../hooks/useSimulation'
import { useT } from '../../../i18n'

const MIN_WAYPOINTS_FOR_PATH = 2

// Start / Stop / Pause / Resume / Move action cluster on the right of
// the dock. Layout flips with mode + run-state:
//   * Teleport — single "Move" (disabled without dest).
//   * Running  — Pause/Resume + Stop.
//   * Idle     — single "Start" (disabled until setup is valid).
export default function ActionGroup() {
  const t = useT()
  const {
    sim,
    handleStart, handleStop, handlePause, handleResume, handleTeleport,
  } = useSimContext()
  const { isRunning, isPaused, destPos } = useSimDerived()
  const mode = sim.mode
  const waypointCount = sim.waypoints.length

  if (mode === SimMode.Teleport) {
    return (
      <div className="flex gap-1.5">
        <ActionBtn
          tone="accent"
          disabled={!destPos}
          onClick={() => { if (destPos) handleTeleport(destPos.lat, destPos.lng) }}
        >
          <ArrowRight className="w-3 h-3" strokeWidth={3} />
          {t('teleport.move')}
        </ActionBtn>
      </div>
    )
  }

  if (isRunning) {
    return (
      <div className="flex gap-1.5">
        {isPaused ? (
          <ActionBtn tone="accent" onClick={handleResume}>
            <Play className="w-3 h-3" fill="currentColor" />
            {t('generic.resume')}
          </ActionBtn>
        ) : (
          <ActionBtn tone="ghost" onClick={handlePause}>
            <Pause className="w-3 h-3" fill="currentColor" />
            {t('generic.pause')}
          </ActionBtn>
        )}
        <ActionBtn tone="danger" onClick={handleStop}>
          <Square className="w-[10px] h-[10px]" fill="currentColor" />
          {t('generic.stop')}
        </ActionBtn>
      </div>
    )
  }

  // Idle — Start (disabled until setup is valid).
  const disabled = isStartDisabled(mode, destPos, waypointCount)
  return (
    <div className="flex gap-1.5">
      <ActionBtn tone="accent" disabled={disabled} onClick={handleStart}>
        <Play className="w-3 h-3" fill="currentColor" />
        {t('generic.start')}
      </ActionBtn>
    </div>
  )
}

function isStartDisabled(
  mode: SimMode,
  destPos: { lat: number; lng: number } | null,
  waypointCount: number,
): boolean {
  if (mode === SimMode.Navigate) return !destPos
  if (mode === SimMode.Loop || mode === SimMode.MultiStop) {
    return waypointCount < MIN_WAYPOINTS_FOR_PATH
  }
  return false
}

interface ActionBtnProps {
  tone: 'accent' | 'danger' | 'ghost'
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}

function ActionBtn({ tone, onClick, disabled, children }: ActionBtnProps) {
  const palette = tone === 'danger'
    ? { bg: 'var(--color-danger-dim)', border: '1px solid rgba(255,71,87,0.35)', color: 'var(--color-danger-text)', hover: 'rgba(255,71,87,0.22)' }
    : tone === 'ghost'
      ? { bg: 'var(--color-surface-ghost)', border: '1px solid var(--color-border)', color: 'var(--color-text-1)', hover: 'rgba(255,255,255,0.08)' }
      : { bg: 'var(--color-accent)', border: 'none', color: 'var(--color-surface-0)', hover: 'var(--color-accent-hover)' }

  // Hover lives in `.dock-action-btn:hover` (legacy.css), driven by the
  // `--dock-bg` / `--dock-hover-bg` custom properties below — keeps tone
  // palettes per-instance while keeping the hover transition in CSS.
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'dock-action-btn',
        'inline-flex items-center justify-center gap-2 h-11 px-[18px] rounded-xl',
        'text-[13px] font-semibold whitespace-nowrap',
        'transition-[background,opacity,box-shadow] duration-150 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
      ].join(' ')}
      style={{
        ['--dock-bg' as string]: palette.bg,
        ['--dock-hover-bg' as string]: palette.hover,
        border: palette.border,
        color: palette.color,
        boxShadow: tone === 'accent' && !disabled ? 'var(--shadow-glow)' : undefined,
      } as React.CSSProperties}
    >
      {children}
    </button>
  )
}
