import { useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ICON_SIZE } from '../../lib/icons'
import KebabMenu from './KebabMenu'

export interface Chip<Id extends string = string> {
  id: Id
  label: React.ReactNode
  color?: string
  count?: number
}

interface ChipFilterBarProps<Id extends string> {
  chips: readonly Chip<Id>[]
  activeId: Id
  onChange: (id: Id) => void
  /** Visible-chip cap before overflow becomes "More ▾". Keep small so the
      bar never wraps — default 5 works well for a 420px drawer. */
  visibleCap?: number
  ariaLabel?: string
  moreLabel?: string
  className?: string
}

// Horizontal scrollable chip filter. When `chips.length > visibleCap`,
// the overflow is folded into a "More ▾" popover so the row stays tidy
// regardless of how many categories the user creates.
export default function ChipFilterBar<Id extends string>({
  chips,
  activeId,
  onChange,
  visibleCap = 5,
  ariaLabel,
  moreLabel = 'More',
  className,
}: ChipFilterBarProps<Id>) {
  const [moreOpenSignal, setMoreOpenSignal] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the active chip visible when overflow exists: if the active chip
  // would be in the overflow popover, promote it into the visible bucket.
  const { visible, overflow } = useMemo(() => {
    if (chips.length <= visibleCap) return { visible: chips, overflow: [] as Chip<Id>[] }
    const head = chips.slice(0, visibleCap - 1)
    const tail = chips.slice(visibleCap - 1)
    const activeInTail = tail.find((c) => c.id === activeId)
    if (activeInTail) {
      const swapped = [...head.slice(0, -1), activeInTail, head[head.length - 1]]
      const rest = [...tail.filter((c) => c.id !== activeId), head[head.length - 1]].filter(Boolean) as Chip<Id>[]
      return { visible: swapped, overflow: rest }
    }
    return { visible: head, overflow: tail }
  }, [chips, visibleCap, activeId])

  const overflowIncludesActive = overflow.some((c) => c.id === activeId)

  return (
    <div
      ref={scrollRef}
      role="group"
      aria-label={ariaLabel}
      className={['chip-filter-bar', className].filter(Boolean).join(' ')}
    >
      {visible.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="chip-filter-chip"
          aria-pressed={chip.id === activeId}
          onClick={() => onChange(chip.id)}
        >
          {chip.color && (
            <span
              aria-hidden="true"
              className="chip-filter-dot"
              style={{ background: chip.color }}
            />
          )}
          <span>{chip.label}</span>
          {typeof chip.count === 'number' && (
            <span className="opacity-60 tabular-nums text-[10px]">{chip.count}</span>
          )}
        </button>
      ))}
      {overflow.length > 0 && (
        <KebabMenu
          key={moreOpenSignal}
          ariaLabel={moreLabel}
          items={overflow.map((chip) => ({
            id: String(chip.id),
            label: chip.label,
            colorDot: chip.color,
            onSelect: () => {
              onChange(chip.id)
              setMoreOpenSignal((n) => n + 1)
            },
          }))}
          trigger={
            <button
              type="button"
              className="chip-filter-chip"
              aria-pressed={overflowIncludesActive}
            >
              <span>{moreLabel}</span>
              <ChevronDown width={ICON_SIZE.xs} height={ICON_SIZE.xs} aria-hidden="true" />
            </button>
          }
        />
      )}
    </div>
  )
}
