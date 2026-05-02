import { useSimContext } from '../../../contexts/SimContext'
import { useT } from '../../../i18n'
import { RADIUS_PRESETS } from '../../../lib/constants'

const KM_THRESHOLD_M = 1000

// Random-walk radius preset row. Renders the canonical preset chips
// from `RADIUS_PRESETS` and a live readout. Zero local state — the
// active value lives on the simulation context.
export default function RadiusRow() {
  const t = useT()
  const { randomWalkRadius, setRandomWalkRadius } = useSimContext()
  const valText = formatRadius(randomWalkRadius)
  return (
    <div className="mt-3.5 flex items-center gap-2.5 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-3)]">
        {t('panel.waypoints_radius')}
      </span>
      <div
        className="flex gap-1 p-[3px] rounded-[10px] border border-[var(--color-border)]"
        style={{ background: 'var(--color-surface-ghost)' }}
      >
        {RADIUS_PRESETS.map((r) => {
          const active = r === randomWalkRadius
          const label = r >= KM_THRESHOLD_M ? `${r / KM_THRESHOLD_M}km` : `${r}m`
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRandomWalkRadius(r)}
              aria-pressed={active}
              className={[
                'h-8 px-3 rounded-[7px] font-mono text-[12px] font-medium',
                'transition-colors duration-120 cursor-pointer',
                active
                  ? 'text-[var(--color-accent-strong)]'
                  : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
              ].join(' ')}
              style={active ? {
                background: 'var(--color-accent-dim)',
                boxShadow: 'var(--shadow-avatar-ring-subtle)',
              } : undefined}
            >
              {label}
            </button>
          )
        })}
      </div>
      <span className="ml-auto font-mono text-[13px] text-[var(--color-text-1)] font-semibold">
        {valText}
      </span>
    </div>
  )
}

function formatRadius(value: number): string {
  if (value < KM_THRESHOLD_M) return `${value} m`
  const km = value / KM_THRESHOLD_M
  const decimals = value % KM_THRESHOLD_M === 0 ? 0 : 1
  return `${km.toFixed(decimals)} km`
}
