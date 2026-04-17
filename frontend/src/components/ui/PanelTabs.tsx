import { useCallback, useRef } from 'react'

export interface PanelTab<Id extends string = string> {
  id: Id
  label: string
  count?: number
}

interface PanelTabsProps<Id extends string> {
  tabs: readonly PanelTab<Id>[]
  activeId: Id
  onChange: (id: Id) => void
  ariaLabel?: string
  className?: string
}

// ARIA-compliant tablist. Arrow keys (Left/Right + Home/End) cycle tabs.
// Callers own the panel content; this only renders the trigger strip.
export default function PanelTabs<Id extends string>({
  tabs,
  activeId,
  onChange,
  ariaLabel,
  className,
}: PanelTabsProps<Id>) {
  const refs = useRef<Map<Id, HTMLButtonElement>>(new Map())

  const focusIndex = useCallback((i: number) => {
    const clamped = (i + tabs.length) % tabs.length
    const tab = tabs[clamped]
    if (!tab) return
    const el = refs.current.get(tab.id)
    el?.focus()
    onChange(tab.id)
  }, [tabs, onChange])

  const onKey = useCallback((e: React.KeyboardEvent, i: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        focusIndex(i + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        focusIndex(i - 1)
        break
      case 'Home':
        e.preventDefault()
        focusIndex(0)
        break
      case 'End':
        e.preventDefault()
        focusIndex(tabs.length - 1)
        break
    }
  }, [focusIndex, tabs.length])

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={['tab-list', className].filter(Boolean).join(' ')}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === activeId
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el)
              else refs.current.delete(tab.id)
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKey(e, i)}
            className="tab-trigger"
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span className="tab-trigger-count">{tab.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Helper id-matcher for the panel the tab controls.
export function panelPropsForTab(tabId: string) {
  return {
    role: 'tabpanel' as const,
    id: `tabpanel-${tabId}`,
    'aria-labelledby': `tab-${tabId}`,
  }
}
