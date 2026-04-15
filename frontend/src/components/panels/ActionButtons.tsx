import { Play, Square, Pause } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'

export default function ActionButtons() {
  const { handleStart, handleStop, handlePause, handleResume, isRunning, isPaused } = useSimContext()
  const t = useT()

  if (!isRunning) {
    return (
      <button
        className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] text-white font-medium
                   flex items-center justify-center gap-2 transition-opacity
                   hover:opacity-90 active:opacity-80"
        onClick={handleStart}
      >
        <Play size={16} fill="currentColor" />
        {t('generic.start')}
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <button
        className="flex-1 py-2 rounded-xl bg-[var(--color-danger)] text-white font-medium
                   flex items-center justify-center gap-2 transition-opacity
                   hover:opacity-90 active:opacity-80"
        onClick={handleStop}
      >
        <Square size={14} fill="currentColor" />
        {t('generic.stop')}
      </button>

      {!isPaused ? (
        <button
          className="flex-1 py-2 rounded-xl bg-[var(--color-bg-elevated)] text-[var(--color-text-1)]
                     border border-white/10 font-medium flex items-center justify-center gap-2
                     transition-colors hover:bg-white/10 active:bg-white/5"
          onClick={handlePause}
        >
          <Pause size={14} fill="currentColor" />
          {t('generic.pause')}
        </button>
      ) : (
        <button
          className="flex-1 py-2 rounded-xl bg-[var(--color-accent)] text-white font-medium
                     flex items-center justify-center gap-2 transition-opacity
                     hover:opacity-90 active:opacity-80"
          onClick={handleResume}
        >
          <Play size={14} fill="currentColor" />
          {t('generic.resume')}
        </button>
      )}
    </div>
  )
}
