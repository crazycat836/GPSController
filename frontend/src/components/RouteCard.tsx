import React, { useRef, useEffect, useState } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RoutePoint {
  /** Unique key for React rendering */
  id: string
  /** Display label (e.g. "My location", "Waypoint 1") */
  label: string
  /** Coordinates — null means "not yet set" */
  position: { lat: number; lng: number } | null
  /** Placeholder text when position is null */
  placeholder?: string
  /** Icon element rendered to the left of the label */
  icon: React.ReactNode
  /** Optional action buttons rendered on the right */
  actions?: React.ReactNode
  /** Color for the label text (defaults to --color-text-1) */
  labelColor?: string
  /** Color for the coordinate text (defaults to --color-accent) */
  coordColor?: string
}

export interface RouteCardProps {
  /** Card header title */
  title: string
  /** Optional content right-aligned in the header row */
  titleExtra?: React.ReactNode
  /** Rendered between header and point list (e.g. generation controls) */
  header?: React.ReactNode
  /** Ordered list of route points (origin → waypoints → destination) */
  points: RoutePoint[]
  /** Max visible rows before scrolling kicks in (default 5) */
  maxVisible?: number
  /** Use compact row styling for dense lists */
  compact?: boolean
  /** Rendered at the bottom of the point list when provided */
  footer?: React.ReactNode
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RouteCard({
  title,
  titleExtra,
  header,
  points,
  maxVisible = 5,
  compact = false,
  footer,
}: RouteCardProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(48)

  /* Measure first row to compute scroll container height */
  useEffect(() => {
    if (!listRef.current) return
    const firstRow = listRef.current.querySelector<HTMLElement>('[data-route-point]')
    if (firstRow) {
      setRowHeight(firstRow.offsetHeight)
    }
  }, [points.length])

  const needsScroll = points.length > maxVisible
  const scrollMaxHeight = rowHeight * maxVisible

  return (
    <div className="seg">
      {/* Header */}
      <div className="seg-row seg-row-header">
        <span className="seg-label">{title}</span>
        {titleExtra ?? (
          points.length > maxVisible
            ? <span className="seg-unit ml-auto">{points.length}</span>
            : null
        )}
      </div>

      {header}

      {/* Point list */}
      <div
        ref={listRef}
        className="route-card-list"
        style={needsScroll ? {
          maxHeight: scrollMaxHeight,
          overflowY: 'auto',
        } : undefined}
      >
        {points.map((pt, idx) => (
          <RoutePointRow
            key={pt.id}
            point={pt}
            isFirst={idx === 0}
            isLast={idx === points.length - 1}
            showConnector={points.length > 1}
            compact={compact}
          />
        ))}
      </div>

      {footer}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Point row                                                          */
/* ------------------------------------------------------------------ */

interface RoutePointRowProps {
  point: RoutePoint
  isFirst: boolean
  isLast: boolean
  showConnector: boolean
  compact: boolean
}

function RoutePointRow({ point, isFirst, isLast, showConnector, compact }: RoutePointRowProps) {
  const { label, position, placeholder, icon, actions, labelColor, coordColor } = point

  return (
    <div
      data-route-point
      className={compact ? 'route-card-point route-card-point-compact' : 'route-card-point'}
      style={{ position: 'relative' }}
    >
      {/* Vertical connector line */}
      {showConnector && !isLast && (
        <div className="route-card-connector" />
      )}

      {/* Icon */}
      <div className="route-card-icon">
        {icon}
      </div>

      {/* Content */}
      {compact ? (
        /* Compact: single-line label + coords inline */
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span
            className="text-[13px] font-semibold shrink-0"
            style={{ color: labelColor ?? 'var(--color-text-1)', minWidth: 32 }}
          >
            {label}
          </span>
          {position && (
            <span
              className="font-mono text-[13px] truncate"
              style={{ color: coordColor ?? 'var(--color-text-2)' }}
            >
              {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </span>
          )}
          {!position && placeholder && (
            <span className="text-[13px]" style={{ color: 'var(--color-text-3)' }}>
              {placeholder}
            </span>
          )}
        </div>
      ) : (
        /* Normal: two-line label + coords stacked */
        <div className="flex-1 min-w-0">
          <div
            className="text-[13px] font-semibold"
            style={{ color: labelColor ?? 'var(--color-text-1)' }}
          >
            {label}
          </div>
          {position ? (
            <div
              className="font-mono text-[13px] mt-0.5 truncate"
              style={{ color: coordColor ?? 'var(--color-accent)' }}
            >
              {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
            </div>
          ) : placeholder ? (
            <div
              className="text-[13px] mt-0.5"
              style={{ color: 'var(--color-accent)' }}
            >
              {placeholder}
            </div>
          ) : null}
        </div>
      )}

      {/* Actions */}
      {actions}
    </div>
  )
}
