import { Flower, Repeat } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSimActions, useSimState } from '../../../contexts/SimContext'
import { useSimDerived } from '../../../contexts/SimDerivedContext'
import { SimMode } from '../../../hooks/useSimulation'
import { useT, type StringKey } from '../../../i18n'

const OPTIONS: ReadonlyArray<{ mode: SimMode; Icon: LucideIcon; labelKey: StringKey }> = [
  { mode: SimMode.Loop, Icon: Repeat, labelKey: 'dock.loop' },
  { mode: SimMode.Flower, Icon: Flower, labelKey: 'mode.flower' },
]

// Loop | Flower switch shown in the dock header while the Route tab is
// active. Both share the staged waypoint chain (setMode keeps it within
// the Route family). Locked while a run is in flight so the dock never
// shows controls for a mode other than the one running.
export default function RouteSubModeToggle() {
  const t = useT()
  const { mode } = useSimState()
  const { setMode } = useSimActions()
  const { isRunning } = useSimDerived()

  return (
    <div
      role="radiogroup"
      aria-label={t('dock.route_submode_aria')}
      className="flex gap-1 p-[3px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-ghost)] shrink-0"
    >
      {OPTIONS.map(({ mode: m, Icon, labelKey }) => {
        const on = mode === m
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={isRunning && !on}
            onClick={() => setMode(m)}
            className={[
              'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg',
              'text-[12px] font-medium whitespace-nowrap',
              'transition-colors duration-150 cursor-pointer',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
              on
                ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-strong)]'
                : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-white/[0.04]',
            ].join(' ')}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{t(labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
