import { Play, Square, Pause } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

export default function ActionButtons() {
  const { handleStart, handleStop, handlePause, handleResume, isRunning, isPaused } = useSimContext()
  const t = useT()

  if (!isRunning) {
    return (
      <div className="pt-2">
        <button className="seg-cta seg-cta-accent" onClick={handleStart}>
          <Play size={14} fill="currentColor" />
          {t('generic.start')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex gap-2 pt-2">
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
    </div>
  )
}
