import { Footprints, Rabbit, Car } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSimContext } from '../../../contexts/SimContext'
import { MoveMode } from '../../../hooks/useSimulation'
import { useT, type StringKey } from '../../../i18n'
import {
  SPEED_PRESETS as BASE_SPEED_PRESETS,
  isSpeedPresetActive,
  type SpeedPresetMode,
} from '../../../lib/constants'

interface SpeedPreset {
  mode: MoveMode
  Icon: LucideIcon
  labelKey: StringKey
  value: number
}

// Per-preset UI metadata layered on top of the canonical km/h presets in
// `lib/constants`. Icons map to design's Walk / Run / Drive glyphs; lucide's
// Footprints / Rabbit / Car are the closest analogues.
const PRESET_UI: Record<SpeedPresetMode, { Icon: LucideIcon; labelKey: StringKey }> = {
  walking: { Icon: Footprints, labelKey: 'move.walking' },
  running: { Icon: Rabbit,     labelKey: 'move.running' },
  driving: { Icon: Car,        labelKey: 'move.driving' },
}

const SPEED_PRESETS: readonly SpeedPreset[] = BASE_SPEED_PRESETS.map((p) => ({
  mode: p.mode as MoveMode,
  value: p.kmh,
  ...PRESET_UI[p.mode],
}))

// Speed preset toggle group. A preset is "active" only when the live
// move mode matches AND no custom/min/max override is set, so flipping
// to a preset always wipes the custom override fields.
export default function SpeedToggle() {
  const t = useT()
  const { sim } = useSimContext()

  const onPreset = (mode: MoveMode) => {
    sim.setMoveMode(mode)
    sim.setCustomSpeedKmh(null)
    sim.setSpeedMinKmh(null)
    sim.setSpeedMaxKmh(null)
  }

  return (
    <div
      role="group"
      aria-label={t('panel.speed')}
      className="flex gap-0.5 p-[3px] h-11 rounded-xl border border-[var(--color-border)]"
      style={{ background: 'var(--color-surface-ghost)' }}
    >
      {SPEED_PRESETS.map(({ mode, Icon, labelKey, value }) => {
        const on = isSpeedPresetActive(mode, sim)
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onPreset(mode)}
            aria-pressed={on}
            className={[
              'inline-flex items-center gap-1.5 px-3.5 rounded-[9px] text-[13px] font-medium',
              'transition-colors duration-150',
              on ? 'text-[var(--color-accent-strong)]' : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
            ].join(' ')}
            style={on ? {
              background: 'var(--color-accent-dim)',
              border: '1px solid rgba(255,255,255,0.06)',
            } : undefined}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t(labelKey)}</span>
            <span className="font-mono text-[11px] opacity-65 tabular-nums">{value}</span>
          </button>
        )
      })}
    </div>
  )
}
