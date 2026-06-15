import { Crosshair, Navigation, SquareCheckBig, Gamepad2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { SimMode, isRouteSubMode } from '../../hooks/useSimulation'
import { useT } from '../../i18n'
import type { StringKey } from '../../i18n'

// Re-export so existing importers (App.tsx) keep their import path working.
// The canonical definition now lives in hooks/useSimulation so the sim
// layer's `setMode` guard can share it.
export { isRouteSubMode }

interface DockModeEntry {
  id: string
  icon: LucideIcon
  labelKey: StringKey
  kbd: string
  isActive: (mode: SimMode) => boolean
  onSelect: (current: SimMode, lastRouteSub: SimMode) => SimMode
}

const dockModes: DockModeEntry[] = [
  {
    id: 'teleport',
    icon: Crosshair,
    labelKey: 'mode.teleport',
    kbd: '1',
    isActive: (m) => m === SimMode.Teleport,
    onSelect: () => SimMode.Teleport,
  },
  {
    id: 'navigate',
    icon: Navigation,
    labelKey: 'mode.navigate',
    kbd: '2',
    isActive: (m) => m === SimMode.Navigate,
    onSelect: () => SimMode.Navigate,
  },
  {
    id: 'route',
    icon: SquareCheckBig,
    labelKey: 'mode.route',
    kbd: '3',
    isActive: (m) => isRouteSubMode(m),
    onSelect: (_cur, lastRouteSub) => lastRouteSub,
  },
  {
    id: 'joystick',
    icon: Gamepad2,
    labelKey: 'mode.joystick',
    kbd: '4',
    isActive: (m) => m === SimMode.Joystick,
    onSelect: () => SimMode.Joystick,
  },
]

interface BottomModeBarProps {
  activeMode: SimMode
  onModeChange: (mode: SimMode) => void
  lastRouteSubMode: SimMode
}

export default function BottomModeBar({ activeMode, onModeChange, lastRouteSubMode }: BottomModeBarProps) {
  const t = useT()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const activeIndex = Math.max(0, dockModes.findIndex((m) => m.isActive(activeMode)))

  const selectAt = useCallback((i: number) => {
    const n = (i + dockModes.length) % dockModes.length
    const entry = dockModes[n]
    refs.current[n]?.focus()
    onModeChange(entry.onSelect(activeMode, lastRouteSubMode))
  }, [activeMode, lastRouteSubMode, onModeChange])

  // ARIA tablist roving navigation: a single tab stop (the active tab),
  // arrow keys move focus + activate, Home/End jump to the ends.
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
        e.preventDefault(); selectAt(dockModes.length - 1); break
    }
  }, [selectAt])

  return (
    <nav
      data-fc="bottom.mode-bar"
      aria-label={t('shell.modes_aria')}
      className={[
        'glass-pill-strong fixed bottom-3 left-1/2 -translate-x-1/2 z-[var(--z-ui)]',
        'flex items-center gap-1.5 p-2',
        // Reserve a wider side gutter than the dock (128px vs 48px) so the
        // centered bar never slides under the bottom-right zoom controls at
        // the minimum window width.
        'w-[min(920px,calc(100vw-128px))] overflow-x-auto scrollbar-none',
      ].join(' ')}
      role="tablist"
    >
      {dockModes.map(({ id, icon: Icon, labelKey, kbd, isActive, onSelect }, i) => {
        const active = isActive(activeMode)
        return (
          <button
            key={id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t(labelKey)}
            tabIndex={i === activeIndex ? 0 : -1}
            title={`${t(labelKey)} (${kbd})`}
            onClick={() => onModeChange(onSelect(activeMode, lastRouteSubMode))}
            onKeyDown={(e) => onKey(e, i)}
            className={[
              'flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-full',
              'text-[13px] font-medium whitespace-nowrap',
              'transition-[background,color,box-shadow] duration-150 cursor-pointer',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
              active
                ? 'bg-[var(--color-accent)] text-[var(--color-surface-0)] font-semibold'
                : 'text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-white/[0.04]',
            ].join(' ')}
            style={active ? { boxShadow: 'var(--shadow-glow)' } : undefined}
          >
            <span className="w-5 h-5 inline-flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" />
            </span>
            <span className={active ? '' : 'hidden sm:inline'}>{t(labelKey)}</span>
            <span
              className="font-mono text-[10px] px-[5px] py-px rounded"
              style={active
                ? { background: 'rgba(0,0,0,0.15)', color: 'rgba(0,0,0,0.6)' }
                : { background: 'rgba(255,255,255,0.06)', color: 'var(--color-text-3)' }
              }
              aria-hidden="true"
            >
              {kbd}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
