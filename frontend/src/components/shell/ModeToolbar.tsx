import React from 'react'
import { Crosshair, Navigation, Repeat, Route, Shuffle, Gamepad2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SimMode } from '../../hooks/useSimulation'
import { useT } from '../../i18n'
import type { StringKey } from '../../i18n'
import VerticalToolbar, { ToolbarButton, ToolbarDivider } from './VerticalToolbar'

const modes: Array<{ mode: SimMode; icon: LucideIcon; labelKey: StringKey }> = [
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
    <nav aria-label="Simulation modes">
    <VerticalToolbar
      className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-1/2 -translate-y-1/2 z-[var(--z-ui)]"
    >
      {modes.map(({ mode, icon: Icon, labelKey }, idx) => (
        <React.Fragment key={mode}>
          {idx === 3 && <ToolbarDivider />}
          <ToolbarButton
            icon={<Icon className="w-[18px] h-[18px]" />}
            label={t(labelKey)}
            active={activeMode === mode}
            onClick={() => onModeChange(mode)}
          />
        </React.Fragment>
      ))}
    </VerticalToolbar>
    </nav>
  )
}
