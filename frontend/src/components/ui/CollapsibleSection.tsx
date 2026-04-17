import React, { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ICON_SIZE } from '../../lib/icons'

interface CollapsibleSectionProps {
  title: React.ReactNode
  icon?: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  /** Controlled open state. Omit to use internal state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Default open state when uncontrolled. */
  defaultOpen?: boolean
  /** localStorage key to persist open state across sessions. */
  persistKey?: string
  children: React.ReactNode
  className?: string
}

// Accordion-style section. Used for Device drawer's Wi-Fi Tunnel block
// so the heavyweight controls stay out of sight until the user asks for them.
export default function CollapsibleSection({
  title,
  icon,
  subtitle,
  trailing,
  open,
  onOpenChange,
  defaultOpen,
  persistKey,
  children,
  className,
}: CollapsibleSectionProps) {
  const [internal, setInternal] = useState<boolean>(() => {
    if (persistKey) {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(persistKey) : null
      if (stored != null) return stored === '1'
    }
    return defaultOpen ?? false
  })
  const isControlled = open != null
  const isOpen = isControlled ? open : internal

  useEffect(() => {
    if (!isControlled && persistKey) {
      try { localStorage.setItem(persistKey, isOpen ? '1' : '0') } catch { /* ignore */ }
    }
  }, [isOpen, persistKey, isControlled])

  const toggle = () => {
    const next = !isOpen
    onOpenChange?.(next)
    if (!isControlled) setInternal(next)
  }

  return (
    <div
      className={['collapsible-section', className].filter(Boolean).join(' ')}
      data-open={isOpen ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="collapsible-section-header"
      >
        {icon && <span className="text-[var(--color-text-3)] shrink-0">{icon}</span>}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-[var(--color-text-2)] truncate">{title}</div>
          {subtitle != null && (
            <div className="text-[10px] text-[var(--color-text-3)] opacity-80 truncate">{subtitle}</div>
          )}
        </div>
        {trailing != null && <span className="shrink-0">{trailing}</span>}
        <ChevronDown
          className="collapsible-section-chevron shrink-0"
          width={ICON_SIZE.sm}
          height={ICON_SIZE.sm}
          aria-hidden="true"
        />
      </button>
      {isOpen && <div className="collapsible-section-body">{children}</div>}
    </div>
  )
}
