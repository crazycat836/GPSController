import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Crosshair, Navigation, Repeat, Route, Shuffle, Gamepad2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import type { StringKey } from '../../i18n'
import { SimMode } from '../../hooks/useSimulation'

const modeIcons: Record<SimMode, LucideIcon> = {
  [SimMode.Teleport]: Crosshair,
  [SimMode.Navigate]: Navigation,
  [SimMode.Loop]: Repeat,
  [SimMode.MultiStop]: Route,
  [SimMode.RandomWalk]: Shuffle,
  [SimMode.Joystick]: Gamepad2,
}

const modeLabelKeys: Record<SimMode, StringKey> = {
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
        'fixed top-14 left-3 w-[22rem] z-[1001]',
        'bg-[var(--color-surface-1)] border border-[var(--color-border)]',
        'rounded-2xl overflow-hidden flex flex-col p-3_5 gap-3',
        'shadow-[var(--shadow-lg)]',
        'transition-all duration-200 ease-[var(--ease-out-expo)]',
        collapsed ? '' : 'max-h-[calc(100vh-80px)]',
      ].join(' ')}
    >
      {/* Header — floats inside panel with its own rounding */}
      <div
        className="flex items-center gap-2_5 px-4 py-3 rounded-xl cursor-pointer select-none shrink-0"
        style={{ background: 'linear-gradient(135deg, rgba(108,140,255,0.1) 0%, rgba(108,140,255,0.03) 100%)' }}
        onClick={() => setCollapsed(prev => !prev)}
      >
        <Icon className="w-5 h-5 text-[var(--color-accent)]" />
        <h2 className="text-[15px] font-bold text-[var(--color-text-1)] flex-1 tracking-tight">
          {t(modeLabelKeys[mode])}
        </h2>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors"
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Scrollable content */}
      {!collapsed && (
        <div className="overflow-y-auto overflow-x-hidden flex-1 scrollbar-thin anim-fade-slide-up pb-1">
          {children}
        </div>
      )}
    </div>
  )
}
