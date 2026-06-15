import { useCallback, useRef } from 'react'
import { Repeat, Route, Shuffle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SimMode } from '../../../hooks/useSimulation'
import { useSimActions, useSimState } from '../../../contexts/SimContext'
import { useT } from '../../../i18n'
import type { StringKey } from '../../../i18n'

interface SubMode {
  mode: SimMode
  icon: LucideIcon
  labelKey: StringKey
}

const SUB_MODES: SubMode[] = [
  { mode: SimMode.Loop, icon: Repeat, labelKey: 'route.sub_loop' },
  { mode: SimMode.MultiStop, icon: Route, labelKey: 'route.sub_multi' },
  { mode: SimMode.RandomWalk, icon: Shuffle, labelKey: 'route.sub_random' },
]

// Segmented switcher for the three Route sub-modes. Without this, Multi-Stop
// and Random Walk were unreachable from the UI — the single "Route" tab in
// BottomModeBar only ever resumed the last sub-mode (defaulting to Loop), and
// nothing else called setMode(MultiStop|RandomWalk). Rendered in the dock
// header whenever a Route sub-mode is active. Switching among these preserves
// the staged waypoints (see useSimulation.setMode).
export default function RouteSubModeBar() {
  const t = useT()
  const { mode } = useSimState()
  const { setMode } = useSimActions()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const activeIndex = Math.max(0, SUB_MODES.findIndex((s) => s.mode === mode))

  const selectAt = useCallback((i: number) => {
    const n = (i + SUB_MODES.length) % SUB_MODES.length
    refs.current[n]?.focus()
    setMode(SUB_MODES[n].mode)
  }, [setMode])

  const onKey = useCallback((e: React.KeyboardEvent, i: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault(); selectAt(i + 1); break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault(); selectAt(i - 1); break
      case 'Home':
        e.preventDefault(); selectAt(0); break
      case 'End':
        e.preventDefault(); selectAt(SUB_MODES.length - 1); break
    }
  }, [selectAt])

  return (
    <div
      role="tablist"
      aria-label={t('route.sub_aria')}
      className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-[var(--color-border)]"
    >
      {SUB_MODES.map((s, i) => {
        const active = s.mode === mode
        const Icon = s.icon
        return (
          <button
            key={s.mode}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t(s.labelKey)}
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => setMode(s.mode)}
            onKeyDown={(e) => onKey(e, i)}
            className={[
              'flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg',
              'text-[12px] font-medium whitespace-nowrap transition-colors cursor-pointer',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
              active
                ? 'text-[var(--color-accent-strong)] font-semibold'
                : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
            ].join(' ')}
            style={active ? { background: 'var(--color-accent-dim)' } : undefined}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
            {t(s.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
