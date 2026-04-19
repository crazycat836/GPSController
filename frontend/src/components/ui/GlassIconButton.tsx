import React, { forwardRef } from 'react'

interface GlassIconButtonProps {
  icon: React.ReactNode
  /** Becomes both the tooltip and aria-label. Not rendered as visible text. */
  label: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}

/**
 * 34×34 rounded-10 glass icon button. Used for the drawer close
 * affordance and the library drawer header action cluster (import /
 * export / GPX). Ref-forwarded so the drawer can focus it on open.
 */
const GlassIconButton = forwardRef<HTMLButtonElement, GlassIconButtonProps>(
  function GlassIconButton({ icon, label, onClick, disabled, className }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={[
          'w-[34px] h-[34px] rounded-[10px] grid place-items-center',
          'text-[var(--color-text-2)] hover:text-[var(--color-text-1)]',
          'bg-white/[0.04] hover:bg-white/[0.08]',
          'border border-[var(--color-border)]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-colors duration-150 cursor-pointer',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]',
          className ?? '',
        ].filter(Boolean).join(' ')}
      >
        {icon}
      </button>
    )
  },
)

export default GlassIconButton
