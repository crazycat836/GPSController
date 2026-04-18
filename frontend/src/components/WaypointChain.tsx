import React from 'react'
import { Plus, X, Repeat } from 'lucide-react'
import { haversineM } from '../lib/geo'

export interface ChainPoint {
  id: string
  label: string
  position: { lat: number; lng: number } | null
  /** 'start' paints the badge green, 'loop' paints it amber. Default paints accent blue. */
  kind?: 'start' | 'accent' | 'loop'
}

interface WaypointChainProps {
  points: readonly ChainPoint[]
  /** When true, renders a "Loop" indicator after the last point. */
  loop?: boolean
  /** When true, renders a dashed "+ Add stop" trailing button. */
  onAdd?: () => void
  /** Per-point remove handler. If present, each chip shows a hover-revealed ✕. */
  onRemove?: (id: string) => void
  /** Click anywhere on a chip — typically to select / focus it on the map. */
  onSelect?: (id: string) => void
  className?: string
}

// Badge letters A..Z then fallback to "·N" numbering after 26 points.
function badgeLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index)
  return `#${index + 1}`
}

// Horizontal waypoint chain from the redesign/Home dock. Chips carry
// per-point badge + label + coord, with distance connectors between
// adjacent points computed via haversine. The Loop indicator mirrors
// the design's amber "Loop" pill at the tail when `loop` is set.
export default function WaypointChain({
  points,
  loop,
  onAdd,
  onRemove,
  onSelect,
  className,
}: WaypointChainProps) {
  if (points.length === 0 && !onAdd) return null

  return (
    <div
      className={[
        'flex items-center gap-0.5 overflow-x-auto pb-1 scrollbar-none',
        className ?? '',
      ].filter(Boolean).join(' ')}
      role="list"
      aria-label="Waypoint chain"
    >
      {points.map((pt, idx) => {
        const prev = idx > 0 ? points[idx - 1] : null
        const distM = prev?.position && pt.position
          ? haversineM(prev.position, pt.position)
          : null
        const next = idx < points.length - 1 ? points[idx + 1] : null
        const showConnector = idx > 0
        const kind = pt.kind ?? (idx === 0 ? 'start' : idx === points.length - 1 && loop ? 'loop' : 'accent')
        return (
          <React.Fragment key={pt.id}>
            {showConnector && (
              <Connector distM={distM} />
            )}
            <Chip
              point={pt}
              index={idx}
              kind={kind}
              onRemove={onRemove}
              onSelect={onSelect}
              removable={!!onRemove && idx > 0}
            />
            {/* Implicit: if this is the last point and loop is on, render Loop indicator */}
            {idx === points.length - 1 && loop && !next && (
              <LoopIndicator
                distM={
                  points[0]?.position && pt.position
                    ? haversineM(pt.position, points[0].position)
                    : null
                }
              />
            )}
          </React.Fragment>
        )
      })}
      {onAdd && <AddButton onClick={onAdd} />}
    </div>
  )
}

interface ChipProps {
  point: ChainPoint
  index: number
  kind: 'start' | 'accent' | 'loop'
  onRemove?: (id: string) => void
  onSelect?: (id: string) => void
  removable: boolean
}

function Chip({ point, index, kind, onRemove, onSelect, removable }: ChipProps) {
  const badge = point.label === 'Current location' || point.label === '目前位置'
    ? 'A'  // start label always uses A regardless of index
    : badgeLetter(index)

  const badgeStyle = {
    start: {
      background: 'rgba(52,211,153,0.15)',
      borderColor: 'rgba(52,211,153,0.35)',
      color: '#6ee5b5',
    },
    accent: {
      background: 'rgba(108,140,255,0.15)',
      borderColor: 'rgba(108,140,255,0.35)',
      color: 'var(--color-accent-strong)',
    },
    loop: {
      background: 'rgba(255,182,39,0.15)',
      borderColor: 'rgba(255,182,39,0.35)',
      color: '#ffd37a',
    },
  }[kind]

  const Tag = onSelect ? 'button' : 'div'
  return (
    <Tag
      {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(point.id) } : {})}
      role="listitem"
      className={[
        'group shrink-0 inline-flex items-center gap-2 h-[34px] pl-1.5 pr-2.5 rounded-[10px]',
        'bg-white/[0.04] border border-[var(--color-border)]',
        'hover:bg-white/[0.07] hover:border-[var(--color-border-strong)]',
        'transition-[background,border-color] duration-150',
        onSelect ? 'cursor-pointer text-left' : '',
      ].join(' ')}
    >
      <span
        className="w-[22px] h-[22px] rounded-[7px] grid place-items-center font-mono text-[10.5px] font-semibold shrink-0 border"
        style={badgeStyle}
      >
        {badge}
      </span>
      <span className="flex flex-col gap-[1px] min-w-0 max-w-[160px]">
        <span className="text-[12px] font-medium text-[var(--color-text-1)] truncate leading-tight">
          {point.label}
        </span>
        {point.position && (
          <span className="font-mono text-[9.5px] text-[var(--color-text-3)] truncate leading-tight">
            {point.position.lat.toFixed(4)}°, {point.position.lng.toFixed(4)}°
          </span>
        )}
      </span>
      {removable && onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(point.id) }}
          className={[
            'w-4 h-4 rounded grid place-items-center -mr-1 ml-0.5',
            'text-[var(--color-text-3)] opacity-0 group-hover:opacity-100',
            'hover:text-[var(--color-danger-text)] hover:bg-[var(--color-danger-dim)]',
            'transition-[opacity,color,background] duration-150',
          ].join(' ')}
          aria-label="Remove"
          title="Remove"
        >
          <X className="w-2.5 h-2.5" strokeWidth={2.5} />
        </button>
      )}
    </Tag>
  )
}

function Connector({ distM }: { distM: number | null }) {
  const label = distM == null
    ? ''
    : distM >= 1000
      ? `${(distM / 1000).toFixed(1)} km`
      : `${Math.round(distM)} m`
  return (
    <span
      className="shrink-0 inline-flex items-center text-[var(--color-text-3)] px-1 font-mono text-[10px]"
      aria-hidden="true"
    >
      <span className="w-3.5 h-[1.5px] bg-current opacity-50 rounded-sm" />
      {label && <span className="ml-1.5 opacity-80">{label}</span>}
      <span className="ml-1.5 w-3.5 h-[1.5px] bg-current opacity-50 rounded-sm" />
    </span>
  )
}

function LoopIndicator({ distM }: { distM: number | null }) {
  const label = distM == null
    ? 'Loop'
    : distM >= 1000
      ? `Loop · ${(distM / 1000).toFixed(1)} km`
      : `Loop · ${Math.round(distM)} m`
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1.5 h-[34px] px-2.5 rounded-[10px] font-mono text-[10px] font-medium uppercase tracking-[0.04em]"
      style={{
        color: '#ffd37a',
        background: 'rgba(255,182,39,0.08)',
        border: '1px solid rgba(255,182,39,0.2)',
      }}
      title="Loops back to start"
    >
      <Repeat className="w-3 h-3" />
      {label}
    </span>
  )
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[10px]',
        'border-[1.5px] border-dashed border-[var(--color-border-strong)]',
        'text-[var(--color-text-2)] text-[12px] font-medium',
        'hover:text-[var(--color-accent-strong)] hover:border-[rgba(108,140,255,0.5)] hover:bg-[var(--color-accent-dim)]',
        'transition-[color,background,border-color] duration-150',
      ].join(' ')}
    >
      <Plus className="w-[11px] h-[11px]" strokeWidth={2.5} />
      Add stop
    </button>
  )
}
