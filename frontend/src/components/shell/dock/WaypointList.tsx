import React from 'react'
import { Crosshair, MapPin, X, Star, Plus, Dices, Repeat } from 'lucide-react'
import { haversineM } from '../../../lib/geo'
import { useT } from '../../../i18n'
import type { ChainPoint } from '../../WaypointChain'

interface WaypointListProps {
  points: readonly ChainPoint[]
  loop?: boolean
  onAdd?: () => void
  onRandom?: () => void
  onRemove?: (id: string) => void
  onBookmark?: (id: string) => void
}

export default function WaypointList({
  points,
  loop,
  onAdd,
  onRandom,
  onRemove,
  onBookmark,
}: WaypointListProps) {
  const t = useT()
  if (points.length === 0 && !onAdd) return null

  return (
    <div className="flex flex-col bg-white/[0.03] border border-[var(--color-border)] rounded-xl overflow-hidden">
      <div className="overflow-y-auto flex-1 min-h-0 max-h-[240px] scrollbar-thin">
        {points.map((pt, idx) => {
          const isStart = idx === 0
          const nextPt = idx < points.length - 1 ? points[idx + 1] : null
          const distM = nextPt?.position && pt.position
            ? haversineM(pt.position, nextPt.position)
            : null
          const distLabel = isStart && distM != null
            ? `Start · ${formatDist(distM)} next`
            : !isStart && distM != null
              ? `Stop ${idx} · ${formatDist(distM)} next`
              : !isStart
                ? `Stop ${idx}`
                : 'Start'

          return (
            <div
              key={pt.id}
              className="grid items-center gap-3 px-3.5 py-2.5 relative"
              style={{ gridTemplateColumns: '28px 1fr auto' }}
            >
              {idx > 0 && (
                <span
                  className="absolute left-[27px] -top-[9px] w-[2px] h-[18px]"
                  style={{
                    background: 'repeating-linear-gradient(to bottom, var(--color-border-strong) 0 3px, transparent 3px 6px)',
                  }}
                  aria-hidden="true"
                />
              )}

              <span
                className="w-7 h-7 rounded-lg grid place-items-center"
                style={isStart ? {
                  background: 'rgba(52,211,153,0.14)',
                  color: '#6ee5b5',
                  border: '1px solid rgba(52,211,153,0.25)',
                } : {
                  background: 'rgba(108,140,255,0.14)',
                  color: '#a8bdff',
                  border: '1px solid rgba(108,140,255,0.25)',
                }}
              >
                {isStart
                  ? <Crosshair className="w-3.5 h-3.5" strokeWidth={2} />
                  : <MapPin className="w-3.5 h-3.5" strokeWidth={2} />}
              </span>

              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] text-[var(--color-text-3)] uppercase tracking-[0.04em] font-medium">
                  {distLabel}
                </span>
                <span className="font-mono text-[12px] text-[var(--color-text-1)]">
                  {pt.position
                    ? `${pt.position.lat.toFixed(4)}°N · ${pt.position.lng.toFixed(4)}°E`
                    : '—'}
                </span>
              </div>

              {isStart ? (
                <button
                  type="button"
                  onClick={() => onBookmark?.(pt.id)}
                  className="w-7 h-7 rounded-[7px] grid place-items-center text-[var(--color-text-3)] hover:text-[#ffb627] hover:bg-[rgba(255,182,39,0.08)] transition-colors cursor-pointer"
                  title={t('chain.bookmark')}
                >
                  <Star className="w-[13px] h-[13px]" strokeWidth={2} />
                </button>
              ) : onRemove ? (
                <button
                  type="button"
                  onClick={() => onRemove(pt.id)}
                  className="w-7 h-7 rounded-[7px] grid place-items-center text-[var(--color-text-3)] hover:text-[#ff4757] hover:bg-[rgba(255,71,87,0.08)] transition-colors cursor-pointer"
                  title={t('chain.remove')}
                >
                  <X className="w-[13px] h-[13px]" strokeWidth={2.5} />
                </button>
              ) : null}
            </div>
          )
        })}

        {loop && points.length > 0 && (
          <div
            className="grid items-center gap-3 px-3.5 py-2.5 relative opacity-70"
            style={{ gridTemplateColumns: '28px 1fr auto' }}
          >
            <span
              className="absolute left-[27px] -top-[9px] w-[2px] h-[18px]"
              style={{
                background: 'repeating-linear-gradient(to bottom, var(--color-border-strong) 0 3px, transparent 3px 6px)',
              }}
              aria-hidden="true"
            />
            <span
              className="w-7 h-7 rounded-lg grid place-items-center text-[var(--color-text-3)] bg-white/[0.04]"
              style={{ border: '1px dashed var(--color-border-strong)' }}
            >
              <Repeat className="w-3.5 h-3.5" strokeWidth={2} />
            </span>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[11px] text-[var(--color-text-3)] uppercase tracking-[0.04em] font-medium">
                {t('chain.loop_back')}
              </span>
              <span className="text-[12px] text-[var(--color-text-3)] italic">
                {t('chain.repeats_route')}
              </span>
            </div>
          </div>
        )}
      </div>

      {(onAdd || onRandom) && (
        <div className="flex gap-2 px-3.5 py-2.5 border-t border-[var(--color-border-subtle)] bg-white/[0.015]">
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="flex-1 h-8 rounded-lg inline-flex items-center justify-center gap-1.5 text-[12px] font-medium bg-[var(--color-accent)] text-[var(--color-surface-0)] hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus className="w-[11px] h-[11px]" strokeWidth={2.5} />
              {t('chain.add_stop')}
            </button>
          )}
          {onRandom && (
            <button
              type="button"
              onClick={onRandom}
              className="flex-1 h-8 rounded-lg inline-flex items-center justify-center gap-1.5 text-[12px] font-medium bg-white/[0.04] border border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-white/[0.08] hover:text-[var(--color-text-1)] transition-colors cursor-pointer"
            >
              <Dices className="w-[11px] h-[11px]" />
              {t('chain.random_stop')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
