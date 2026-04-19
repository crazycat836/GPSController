import React from 'react'
import { Play, Square, Pause } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

interface ActionButtonsProps {
  /** Disables Start while `!isRunning`. Panels that need a
   *  destination / waypoints set first (Navigate / Teleport) pass
   *  their condition here. Defaults to true. */
  canStart?: boolean
  /** Extra button(s) appended after the Start / Stop+Pause+Resume
   *  cluster — used by Navigate / Teleport for their "Clear"
   *  affordance. */
  trailing?: React.ReactNode
}

export default function ActionButtons({ canStart = true, trailing }: ActionButtonsProps = {}) {
  const { handleStart, handleStop, handlePause, handleResume, isRunning, isPaused } = useSimContext()
  const t = useT()

  if (!isRunning) {
    return (
      <div className="flex gap-2 mt-1">
        <button
          className="seg-cta seg-cta-accent flex-1"
          onClick={handleStart}
          disabled={!canStart}
        >
          <Play size={14} fill="currentColor" />
          {t('generic.start')}
        </button>
        {trailing}
      </div>
    )
  }

  return (
    <div className="flex gap-2 mt-1">
      <button className="seg-cta seg-cta-danger flex-1" onClick={handleStop}>
        <Square size={12} fill="currentColor" />
        {t('generic.stop')}
      </button>
      {!isPaused ? (
        <button className="seg-cta seg-cta-ghost flex-1" onClick={handlePause}>
          <Pause size={12} fill="currentColor" />
          {t('generic.pause')}
        </button>
      ) : (
        <button className="seg-cta seg-cta-accent flex-1" onClick={handleResume}>
          <Play size={12} fill="currentColor" />
          {t('generic.resume')}
        </button>
      )}
      {trailing}
    </div>
  )
}
