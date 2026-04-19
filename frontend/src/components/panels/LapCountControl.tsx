import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

interface LapCountControlProps {
  /** Only `multistop` mode needs to treat `loop=false` differently —
   *  the lap target is meaningless if the route only runs once. */
  mode: 'loop' | 'multistop'
}

/**
 * Numeric input for the target lap count. Empty = unlimited (matches
 * backend's `lap_count: None` default). When the simulation is running
 * and a target is set, shows "N / M" progress on the right.
 *
 * Styled with the existing `seg-row` / `seg-input` / `seg-label` tokens
 * used elsewhere in the panel so it blends into the Loop / MultiStop
 * edit stack.
 */
export default function LapCountControl({ mode }: LapCountControlProps) {
  const { sim, isRunning } = useSimContext()
  const t = useT()

  const progress = sim.lapProgress
  const total = progress?.total ?? sim.loopLapCount
  const current = progress?.current ?? 0

  const placeholder = t('loop.lap_count_placeholder')

  return (
    <div className="seg-row border-t border-[var(--color-border-subtle)]">
      <span className="seg-label">{t('loop.lap_count_label')}</span>
      <input
        type="number"
        min={1}
        max={9999}
        value={sim.loopLapCount ?? ''}
        placeholder={placeholder}
        disabled={isRunning}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') {
            sim.setLoopLapCount(null)
            return
          }
          const n = parseInt(raw, 10)
          sim.setLoopLapCount(Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : null)
        }}
        className="seg-input w-16 text-right"
        aria-label={placeholder}
      />
      <span className="seg-unit">{t('loop.lap_count_unit')}</span>
      {isRunning && (mode === 'loop' || (mode === 'multistop' && total != null)) && (
        <span className="ml-auto text-[11px] font-mono text-[var(--color-text-3)]">
          {current} / {total ?? '∞'}
        </span>
      )}
    </div>
  )
}
