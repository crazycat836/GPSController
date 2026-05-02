import { Footprints, Rabbit, Car } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSimContext } from '../../../contexts/SimContext'
import { MoveMode } from '../../../hooks/useSimulation'
import { useT, type StringKey } from '../../../i18n'

interface SpeedPreset {
  mode: MoveMode
  Icon: LucideIcon
  labelKey: StringKey
  value: number
}

// Speed preset rail. Icons map to design's Walk / Run / Drive glyphs;
// lucide's Footprints / Rabbit / Car are the closest analogues.
// km/h values must match `SimContext.SPEED_MAP` and backend
// `SPEED_PROFILES` (m/s equivalents 3.0 / 5.5 / 16.667).
const SPEED_PRESETS: readonly SpeedPreset[] = [
  { mode: MoveMode.Walking, Icon: Footprints, labelKey: 'move.walking', value: 10.8 },
  { mode: MoveMode.Running, Icon: Rabbit,     labelKey: 'move.running', value: 19.8 },
  { mode: MoveMode.Driving, Icon: Car,        labelKey: 'move.driving', value: 60 },
]

// Speed preset toggle group. A preset is "active" only when the live
// move mode matches AND no custom/min/max override is set, so flipping
// to a preset always wipes the custom override fields.
export default function SpeedToggle() {
  const t = useT()
  const { sim } = useSimContext()
  const presetActive = (mode: MoveMode) =>
    sim.moveMode === mode
    && sim.customSpeedKmh == null
    && sim.speedMinKmh == null
    && sim.speedMaxKmh == null

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
        const on = presetActive(mode)
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
