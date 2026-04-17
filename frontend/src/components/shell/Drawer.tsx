import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  icon?: React.ReactNode
  side?: 'left' | 'right'
  width?: string
  children: React.ReactNode
}

export default function Drawer({ open, onClose, title, icon, side = 'right', width = 'w-80', children }: DrawerProps) {
  const isLeft = side === 'left'
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = `drawer-title-${title.replace(/\s+/g, '-').toLowerCase()}`

  // Save previously focused element and focus the close button when drawer opens
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement
      // Defer focus to after the transition starts
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    } else {
      // Return focus when drawer closes
      previousFocusRef.current?.focus()
    }
  }, [open])

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Focus trap
  useEffect(() => {
    if (!open) return
    const panel = closeButtonRef.current?.closest('[role="dialog"]') as HTMLElement | null
    if (!panel) return

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first) return
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handleTrap)
    return () => document.removeEventListener('keydown', handleTrap)
  }, [open])

  return createPortal(
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[var(--z-drawer)] bg-black/30 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[
          'fixed inset-y-0 z-[var(--z-drawer)]',
          isLeft ? 'left-0 border-r' : 'right-0 border-l',
          width,
          'bg-[var(--color-surface-1)]',
          'border-[var(--color-border)]',
          'shadow-[var(--shadow-lg)]',
          'flex flex-col',
          'transform transition-transform duration-[280ms] ease-[var(--ease-out-expo)]',
          open
            ? 'translate-x-0'
            : isLeft ? '-translate-x-full' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[var(--color-border)] shrink-0">
          {icon && <span className="text-[var(--color-accent)]">{icon}</span>}
          <h2 id={titleId} className="text-[14px] font-semibold text-[var(--color-text-1)] flex-1">{title}</h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="w-11 h-11 rounded-lg flex items-center justify-center text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-white/[0.06] transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}
