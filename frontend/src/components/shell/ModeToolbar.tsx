import React from 'react'
import { Crosshair, Navigation, Repeat, Route, Shuffle, Gamepad2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SimMode } from '../../hooks/useSimulation'
import { useT } from '../../i18n'

const modes: Array<{ mode: SimMode; icon: LucideIcon; labelKey: string }> = [
  { mode: SimMode.Teleport, icon: Crosshair, labelKey: 'mode.teleport' },
  { mode: SimMode.Navigate, icon: Navigation, labelKey: 'mode.navigate' },
  { mode: SimMode.Loop, icon: Repeat, labelKey: 'mode.loop' },
  { mode: SimMode.MultiStop, icon: Route, labelKey: 'mode.multi_stop' },
  { mode: SimMode.RandomWalk, icon: Shuffle, labelKey: 'mode.random_walk' },
  { mode: SimMode.Joystick, icon: Gamepad2, labelKey: 'mode.joystick' },
]

interface ModeToolbarProps {
  activeMode: SimMode
  onModeChange: (mode: SimMode) => void
}

export default function ModeToolbar({ activeMode, onModeChange }: ModeToolbarProps) {
  const t = useT()

  return (
    <div
      className={[
        'fixed right-[max(0.75rem,env(safe-area-inset-right))] top-1/2 -translate-y-1/2 z-[800]',
        'flex flex-col gap-1 p-1.5',
        'bg-[var(--color-glass)] backdrop-blur-2xl backdrop-saturate-[1.6]',
        'border border-[var(--color-border)] rounded-[22px]',
        'shadow-[0_14px_36px_rgba(12,18,40,0.48),0_2px_8px_rgba(12,18,40,0.3)]',
      ].join(' ')}
    >
      {modes.map(({ mode, icon: Icon, labelKey }) => {
        const isActive = activeMode === mode
        return (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            className={[
              'w-11 h-11 rounded-full flex items-center justify-center',
              'transition-all duration-150 cursor-pointer',
              'focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] outline-none',
              isActive
                ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent)] shadow-[0_0_12px_rgba(108,140,255,0.25)]'
                : 'text-[var(--color-text-2)] hover:bg-white/8 hover:text-[var(--color-text-1)]',
            ].join(' ')}
            title={t(labelKey as any)}
            aria-label={t(labelKey as any)}
            aria-pressed={isActive}
          >
            <Icon className="w-[18px] h-[18px]" />
          </button>
        )
      })}
    </div>
  )
}
