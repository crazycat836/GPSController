import {
  Crosshair, Navigation, Repeat, Route, Shuffle, Gamepad2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SimMode, MODE_LABEL_KEYS } from '../../../hooks/useSimulation'
import { useT, type StringKey } from '../../../i18n'

// Mirror the BottomModeBar icon mapping so the dock header and the mode
// selector read as the same mode at a glance.
const MODE_ICON_MAP: Record<SimMode, LucideIcon> = {
  [SimMode.Teleport]:   Crosshair,
  [SimMode.Navigate]:   Navigation,
  [SimMode.Loop]:       Repeat,
  [SimMode.MultiStop]:  Route,
  [SimMode.RandomWalk]: Shuffle,
  [SimMode.Joystick]:   Gamepad2,
}

interface EyebrowProps {
  mode: SimMode
}

// Multi-stop gets a warning tint in the design to visually distinguish
// it from the otherwise-accent eyebrow family.
export default function Eyebrow({ mode }: EyebrowProps) {
  const t = useT()
  const accentColor = mode === SimMode.MultiStop
    ? 'var(--color-warning-text)'
    : 'var(--color-accent)'
  const labelKey: StringKey = MODE_LABEL_KEYS[mode]
  const Icon = MODE_ICON_MAP[mode]
  return (
    <div
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] mb-2"
      style={{ color: accentColor }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {t(labelKey)}
    </div>
  )
}
