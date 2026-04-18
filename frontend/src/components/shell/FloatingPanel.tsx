import React, { useState } from 'react'
import { ChevronDown, ChevronUp, Crosshair, Navigation, Repeat, Route, Shuffle, Gamepad2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import { SimMode, MODE_LABEL_KEYS } from '../../hooks/useSimulation'

const modeIcons: Record<SimMode, LucideIcon> = {
  [SimMode.Teleport]: Crosshair,
  [SimMode.Navigate]: Navigation,
  [SimMode.Loop]: Repeat,
  [SimMode.MultiStop]: Route,
  [SimMode.RandomWalk]: Shuffle,
  [SimMode.Joystick]: Gamepad2,
}

interface FloatingPanelProps {
  mode: SimMode
  children: React.ReactNode
}

export default function FloatingPanel({ mode, children }: FloatingPanelProps) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)
  const Icon = modeIcons[mode]
  const contentId = `floating-panel-content-${mode}`

  return (
    <div
      className={[
        'fixed top-[4.25rem] left-3 w-[22rem] z-[var(--z-ui)]',
        // Glass-pill aesthetic to match the redesign/Home dock surface.
        'bg-[rgba(19,20,22,0.82)] backdrop-blur-[24px] backdrop-saturate-150',
        '[-webkit-backdrop-filter:blur(24px)_saturate(1.4)]',
        'border border-[var(--color-border)]',
        'rounded-2xl overflow-hidden flex flex-col p-3_5 gap-3',
        'shadow-[var(--shadow-xl)]',
        '[box-shadow:var(--shadow-xl),inset_0_1px_0_rgba(255,255,255,0.06)]',
        'transition-all duration-200 ease-[var(--ease-out-expo)]',
        // Leave room at the bottom so content doesn't slip under the new
        // BottomModeBar (56px pill + 12px gap from screen bottom).
        collapsed ? '' : 'max-h-[calc(100vh-4.25rem-84px)]',
      ].join(' ')}
    >
      {/* Header — floats inside panel with its own rounding */}
      <div
        className="flex items-center gap-2_5 px-4 py-3 rounded-xl select-none shrink-0"
        style={{ background: 'linear-gradient(135deg, rgba(108,140,255,0.1) 0%, rgba(108,140,255,0.03) 100%)' }}
      >
        <Icon className="w-4 h-4 text-[var(--color-accent)]" />
        <h2 className="text-[13px] font-semibold text-[var(--color-text-1)] flex-1 tracking-tight">
          {t(MODE_LABEL_KEYS[mode])}
        </h2>
        <button
          onClick={() => setCollapsed(prev => !prev)}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[var(--color-text-3)] hover:text-[var(--color-text-2)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Scrollable content */}
      {!collapsed && (
        <div id={contentId} className="overflow-y-auto overflow-x-hidden flex-1 scrollbar-thin anim-fade-slide-up pb-1">
          {children}
        </div>
      )}
    </div>
  )
}
