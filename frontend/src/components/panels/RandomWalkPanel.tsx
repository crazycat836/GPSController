import React from 'react'
import { Circle } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import PauseControl from '../PauseControl'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function RandomWalkPanel() {
  const { sim, randomWalkRadius, setRandomWalkRadius } = useSimContext()
  const t = useT()

  return (
    <div className="space-y-3">
      {/* Radius selector */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-2)]">
          <Circle className="w-3.5 h-3.5" />
          <span>{t('panel.random_walk_range' as any)}</span>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={randomWalkRadius}
            onChange={e => {
              const v = parseInt(e.target.value)
              if (!isNaN(v) && v > 0) setRandomWalkRadius(v)
            }}
            className="flex-1 max-w-24 px-3 py-1.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-1)] text-xs focus:border-[var(--color-accent)] focus:outline-none"
            min="50"
            step="50"
          />
          <span className="text-xs text-[var(--color-text-3)]">{t('panel.meters_radius' as any)}</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[200, 500, 1000, 2000].map(r => (
            <button
              key={r}
              onClick={() => setRandomWalkRadius(r)}
              className={`px-3 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                randomWalkRadius === r
                  ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-2)] border border-[var(--color-border)] hover:bg-white/5'
              }`}
            >
              {r >= 1000 ? `${r / 1000}km` : `${r}m`}
            </button>
          ))}
        </div>
      </div>

      {/* Pause control */}
      {sim.pauseRandomWalk && (
        <PauseControl
          labelKey="pause.random_walk"
          value={sim.pauseRandomWalk}
          onChange={sim.setPauseRandomWalk}
        />
      )}

      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
