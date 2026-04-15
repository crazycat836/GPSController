import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Crosshair, Navigation, Repeat, Route, Shuffle, Gamepad2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import { SimMode } from '../../hooks/useSimulation'

const modeIcons: Record<SimMode, LucideIcon> = {
  [SimMode.Teleport]: Crosshair,
  [SimMode.Navigate]: Navigation,
  [SimMode.Loop]: Repeat,
  [SimMode.MultiStop]: Route,
  [SimMode.RandomWalk]: Shuffle,
  [SimMode.Joystick]: Gamepad2,
}

const modeLabelKeys: Record<SimMode, string> = {
  [SimMode.Teleport]: 'mode.teleport',
  [SimMode.Navigate]: 'mode.navigate',
  [SimMode.Loop]: 'mode.loop',
  [SimMode.MultiStop]: 'mode.multi_stop',
  [SimMode.RandomWalk]: 'mode.random_walk',
  [SimMode.Joystick]: 'mode.joystick',
}

interface FloatingPanelProps {
  mode: SimMode
  children: React.ReactNode
}

export default function FloatingPanel({ mode, children }: FloatingPanelProps) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const Icon = modeIcons[mode]

  return (
    <div
      className={[
        'fixed top-14 left-3 w-80 z-[800]',
        'bg-[var(--color-glass)] backdrop-blur-2xl backdrop-saturate-[1.6]',
        'border border-[var(--color-border)] rounded-[18px]',
        'shadow-[0_14px_36px_rgba(12,18,40,0.48),0_2px_8px_rgba(12,18,40,0.3),inset_0_1px_0_rgba(255,255,255,0.06)]',
        'flex flex-col',
        'transition-all duration-200 ease-[var(--ease-out-expo)]',
        collapsed ? '' : 'max-h-[calc(100vh-80px)]',
      ].join(' ')}
    >
      {/* Panel header with mode icon + title + collapse toggle */}
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none shrink-0"
        onClick={() => setCollapsed(prev => !prev)}
      >
        <Icon className="w-[18px] h-[18px] text-[var(--color-accent)]" />
        <h2 className="text-sm font-semibold text-[var(--color-text-1)] flex-1">
          {t(modeLabelKeys[mode] as any)}
        </h2>
        <button
          className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:bg-white/5 transition-colors"
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Panel content - hidden when collapsed */}
      {!collapsed && (
        <div className="px-3 pb-3 overflow-y-auto overflow-x-hidden flex-1 scrollbar-none">
          {children}
        </div>
      )}
    </div>
  )
}
