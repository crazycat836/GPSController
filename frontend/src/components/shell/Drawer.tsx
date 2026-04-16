import React from 'react'
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

  return createPortal(
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[999] bg-black/30 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={[
          'fixed inset-y-0 z-[1000]',
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
          <h2 className="text-[14px] font-semibold text-[var(--color-text-1)] flex-1">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-white/[0.06] transition-colors cursor-pointer"
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
