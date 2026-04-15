import { X, Dices } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
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
    <>
      {/* ── Waypoints ── */}
      <div className="seg">
        {/* Header */}
        <div className="seg-row">
          <span className="seg-label">{t('panel.waypoints')} ({sim.waypoints.length})</span>
          <span className="seg-unit ml-auto">{t('panel.waypoints_hint')}</span>
        </div>

        {/* Generation: Radius + Count — inline label+input pattern */}
        <div className="seg-row">
          <span className="seg-label">{t('panel.waypoints_radius')}</span>
          <input
            type="number"
            min={10}
            value={wpGenRadius}
            onChange={(e) => setWpGenRadius(Math.max(1, parseInt(e.target.value) || 0))}
            className="seg-input w-16 text-right"
          />
          <span className="seg-unit">m</span>
          <span className="mx-1" />
          <span className="seg-label">{t('panel.waypoints_count')}</span>
          <input
            type="number"
            min={1}
            max={50}
            value={wpGenCount}
            onChange={(e) => setWpGenCount(Math.max(1, parseInt(e.target.value) || 0))}
            className="seg-input w-14 text-right"
          />
          <span className="seg-unit">{t('panel.points')}</span>
        </div>

        {/* Generate buttons — subtle text buttons */}
        <div className="seg-row seg-row-compact" style={{ justifyContent: 'center', gap: '4px' }}>
          <button
            className="seg-text-btn"
            onClick={handleGenerateRandomWaypoints}
            title={t('panel.waypoints_gen_tooltip')}
          >
            <Dices size={11} />
            {t('panel.waypoints_generate')}
          </button>
          <button
            className="seg-text-btn"
            onClick={handleGenerateAllRandom}
            title={t('panel.waypoints_gen_all_tooltip')}
          >
            <Dices size={11} />
            {t('panel.waypoints_generate_all')}
          </button>
        </div>

        {/* Waypoint list */}
        {sim.waypoints.length === 0 ? (
          <div className="seg-row seg-row-compact" style={{ justifyContent: 'center' }}>
            <span className="seg-unit">{t('panel.waypoints_empty')}</span>
          </div>
        ) : (
          <>
            {sim.waypoints.map((wp: { lat: number; lng: number }, i: number) => {
              const seg = sim.waypointProgress?.current
              const approaching = seg != null && i === seg + 1
              const passed = seg != null && i <= seg
              const isStart = i === 0

              return (
                <div
                  key={i}
                  className={[
                    'seg-row seg-row-compact',
                    approaching ? 'bg-orange-500/10' : '',
                    passed ? 'opacity-35' : '',
                  ].join(' ')}
                >
                  <span
                    className="font-semibold w-6 shrink-0 text-[10px]"
                    style={{
                      color: approaching ? '#ff9800' : passed ? '#555' : isStart ? 'var(--color-success)' : '#ff9800',
                    }}
                  >
                    {approaching ? '>' : passed ? 'OK' : isStart ? t('panel.waypoint_start') : `#${i}`}
                  </span>
                  <span className="flex-1 text-[var(--color-text-2)] font-mono text-[10px] opacity-80">
                    {wp.lat.toFixed(5)}, {wp.lng.toFixed(5)}
                  </span>
                  <button
                    className="p-1 rounded-md text-[var(--color-text-3)] hover:text-[var(--color-danger)]
                               hover:bg-[var(--color-danger-dim)] transition-colors cursor-pointer"
                    onClick={() => handleRemoveWaypoint(i)}
                    title={t('panel.waypoints_remove')}
                  >
                    <X size={11} />
                  </button>
                </div>
              )
            })}

            <div className="seg-row seg-row-compact" style={{ justifyContent: 'center' }}>
              <button
                className="seg-text-btn text-[var(--color-text-3)] hover:text-[var(--color-danger)]"
                onClick={handleClearWaypoints}
                disabled={isRunning}
              >
                {t('generic.clear')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Pause ── */}
      <PauseControl
        labelKey={pauseLabelKey}
        value={pauseValue}
        onChange={pauseOnChange}
      />
    </>
  )
}
