import React from 'react'
import { Crosshair, Navigation, Repeat, Route, Shuffle, Gamepad2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SimMode } from '../../hooks/useSimulation'
import { useT } from '../../i18n'
import type { StringKey } from '../../i18n'

const modes: Array<{ mode: SimMode; icon: LucideIcon; labelKey: StringKey; kbd: string }> = [
  { mode: SimMode.Teleport,   icon: Crosshair,  labelKey: 'mode.teleport',    kbd: '1' },
  { mode: SimMode.Navigate,   icon: Navigation, labelKey: 'mode.navigate',    kbd: '2' },
  { mode: SimMode.Loop,       icon: Repeat,     labelKey: 'mode.loop',        kbd: '3' },
  { mode: SimMode.MultiStop,  icon: Route,      labelKey: 'mode.multi_stop',  kbd: '4' },
  { mode: SimMode.RandomWalk, icon: Shuffle,    labelKey: 'mode.random_walk', kbd: '5' },
  { mode: SimMode.Joystick,   icon: Gamepad2,   labelKey: 'mode.joystick',    kbd: '6' },
]

interface BottomModeBarProps {
  activeMode: SimMode
  onModeChange: (mode: SimMode) => void
}

// Horizontal glass-pill mode selector pinned to the bottom-center.
// Mirrors the redesign/Home dock-modes: translucent pill, per-mode button
// expands to a lozenge when active (accent bg + keyboard chip), icon-only
// when inactive so the bar stays narrow.
export default function BottomModeBar({ activeMode, onModeChange }: BottomModeBarProps) {
  const t = useT()

  return (
    <nav
      aria-label="Simulation modes"
      className={[
        'glass-pill-strong fixed bottom-3 left-1/2 -translate-x-1/2 z-[var(--z-ui)]',
        'flex items-center gap-1.5 px-1.5 py-1.5',
        'max-w-[calc(100vw-24px)] overflow-x-auto scrollbar-none',
      ].join(' ')}
      role="tablist"
    >
      {modes.map(({ mode, icon: Icon, labelKey, kbd }) => {
        const active = activeMode === mode
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t(labelKey)}
            title={`${t(labelKey)} (${kbd})`}
            onClick={() => onModeChange(mode)}
            className={[
              'inline-flex items-center gap-2 h-10 px-3 rounded-full',
              'text-[13px] font-medium whitespace-nowrap shrink-0',
              'transition-[background,color,box-shadow] duration-150 cursor-pointer',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
              active
                ? 'bg-[var(--color-accent)] text-[var(--color-surface-0)] font-semibold shadow-[var(--shadow-glow)]'
                : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-white/[0.04]',
            ].join(' ')}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            <span className={active ? '' : 'hidden sm:inline'}>{t(labelKey)}</span>
            {active && (
              <span
                className="font-mono text-[10px] px-1 py-px rounded"
                style={{
                  background: 'rgba(0,0,0,0.18)',
                  color: 'rgba(0,0,0,0.65)',
                }}
                aria-hidden="true"
              >
                {kbd}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
