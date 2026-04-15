import React from 'react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import PauseControl from '../PauseControl'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function RandomWalkPanel() {
  const { sim, randomWalkRadius, setRandomWalkRadius } = useSimContext()
  const t = useT()

  return (
    <>
      <div className="seg-stack">
        {/* ── Range ── */}
        <div className="seg">
          <div className="seg-row">
            <span className="seg-label">{t('panel.random_walk_range' as any)}</span>
            <span className="text-[var(--text-sm)] font-semibold text-[var(--color-text-1)] ml-auto font-mono">
              {randomWalkRadius >= 1000 ? `${randomWalkRadius / 1000}km` : `${randomWalkRadius}m`}
            </span>
          </div>
          <div className="seg-row seg-row-flush">
            <div className="flex gap-1 w-full">
              {[200, 500, 1000, 2000].map(r => (
                <button
                  key={r}
                  onClick={() => setRandomWalkRadius(r)}
                  className={`seg-pill ${randomWalkRadius === r ? 'seg-pill-on' : 'seg-pill-off'}`}
                >
                  {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Pause ── */}
        {sim.pauseRandomWalk && (
          <PauseControl
            labelKey="pause.random_walk"
            value={sim.pauseRandomWalk}
            onChange={sim.setPauseRandomWalk}
          />
        )}

        {/* ── Speed ── */}
        <SpeedControls />
      </div>

      <ActionButtons />
    </>
  )
}
