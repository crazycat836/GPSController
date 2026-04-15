import { MapPin, X } from 'lucide-react'
import { useSimContext, SimMode } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import PauseControl from '../PauseControl'

interface WaypointListProps {
  mode: 'loop' | 'multistop'
}

export default function WaypointList({ mode }: WaypointListProps) {
  const {
    sim,
    wpGenRadius,
    setWpGenRadius,
    wpGenCount,
    setWpGenCount,
    handleGenerateRandomWaypoints,
    handleGenerateAllRandom,
    handleRemoveWaypoint,
    handleClearWaypoints,
    isRunning,
  } = useSimContext()
  const t = useT()

  const pauseValue = mode === 'loop' ? sim.pauseLoop : sim.pauseMultiStop
  const pauseOnChange = mode === 'loop' ? sim.setPauseLoop : sim.setPauseMultiStop
  const pauseLabelKey = mode === 'loop' ? 'pause.loop' as const : 'pause.multi_stop' as const

  return (
    <div className="flex flex-col gap-3">
      {/* Section header */}
      <div className="flex items-center gap-2 text-[var(--color-text-2)]">
        <MapPin size={14} />
        <span className="text-xs font-semibold text-[var(--color-text-1)]">
          {t('panel.waypoints')} ({sim.waypoints.length})
        </span>
        <span className="text-[10px] opacity-50 ml-1">{t('panel.waypoints_hint')}</span>
      </div>

      {/* Pause control */}
      <PauseControl
        labelKey={pauseLabelKey}
        value={pauseValue}
        onChange={pauseOnChange}
      />

      {/* Generation controls */}
      <div className="flex flex-col gap-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="opacity-70 w-9 shrink-0">{t('panel.waypoints_radius')}</span>
          <input
            type="number"
            min={10}
            value={wpGenRadius}
            onChange={(e) => setWpGenRadius(Math.max(1, parseInt(e.target.value) || 0))}
            className="flex-1 rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                       px-2 py-1 text-[11px] text-[var(--color-text-1)]
                       focus:outline-none focus:border-[var(--color-accent)]/40"
          />
          <span className="opacity-50 w-4">m</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="opacity-70 w-9 shrink-0">{t('panel.waypoints_count')}</span>
          <input
            type="number"
            min={1}
            max={50}
            value={wpGenCount}
            onChange={(e) => setWpGenCount(Math.max(1, parseInt(e.target.value) || 0))}
            className="flex-1 rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                       px-2 py-1 text-[11px] text-[var(--color-text-1)]
                       focus:outline-none focus:border-[var(--color-accent)]/40"
          />
          <span className="opacity-50 w-4">{t('panel.points')}</span>
        </div>
        <div className="flex gap-2 mt-1">
          <button
            className="flex-1 py-1 rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                       text-[11px] text-[var(--color-text-2)] hover:text-[var(--color-text-1)]
                       hover:bg-white/10 transition-colors"
            onClick={handleGenerateRandomWaypoints}
            title={t('panel.waypoints_gen_tooltip')}
          >
            {t('panel.waypoints_generate')}
          </button>
          <button
            className="flex-1 py-1 rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                       text-[11px] text-[var(--color-text-2)] hover:text-[var(--color-text-1)]
                       hover:bg-white/10 transition-colors"
            onClick={handleGenerateAllRandom}
            title={t('panel.waypoints_gen_all_tooltip')}
          >
            {t('panel.waypoints_generate_all')}
          </button>
        </div>
      </div>

      {/* Waypoint list */}
      {sim.waypoints.length === 0 && (
        <p className="text-xs text-[var(--color-text-3)] py-1">{t('panel.waypoints_empty')}</p>
      )}

      <div className="flex flex-col gap-0.5">
        {sim.waypoints.map((wp: { lat: number; lng: number }, i: number) => {
          const seg = sim.waypointProgress?.current
          const approaching = seg != null && i === seg + 1
          const passed = seg != null && i <= seg
          const isStart = i === 0

          return (
            <div
              key={i}
              className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-all
                         ${approaching ? 'bg-orange-500/15 border border-orange-500/50 animate-pulse' : 'border border-transparent'}
                         ${passed ? 'opacity-40' : ''}`}
            >
              <span
                className="font-semibold w-6 shrink-0"
                style={{
                  color: approaching ? '#ff9800' : passed ? '#666' : isStart ? 'var(--color-success)' : '#ff9800',
                  fontSize: isStart ? 10 : undefined,
                }}
              >
                {approaching ? '>' : passed ? 'OK' : isStart ? t('panel.waypoint_start') : `#${i}`}
              </span>
              <span className="flex-1 opacity-85 text-[var(--color-text-2)]">
                {wp.lat.toFixed(5)}, {wp.lng.toFixed(5)}
              </span>
              <button
                className="p-0.5 rounded text-[var(--color-text-3)] hover:text-[var(--color-danger)]
                           hover:bg-[var(--color-danger)]/10 transition-colors"
                onClick={() => handleRemoveWaypoint(i)}
                title={t('panel.waypoints_remove')}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Clear all button */}
      {sim.waypoints.length > 0 && (
        <button
          className="w-full py-1.5 rounded-lg bg-[var(--color-bg-elevated)] border border-white/10
                     text-xs text-[var(--color-text-2)] hover:text-[var(--color-danger)]
                     hover:border-[var(--color-danger)]/30 transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleClearWaypoints}
          disabled={isRunning}
        >
          {t('generic.clear')}
        </button>
      )}
    </div>
  )
}
