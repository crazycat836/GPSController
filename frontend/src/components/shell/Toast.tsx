import React from 'react'
import { createPortal } from 'react-dom'

type ToastVariant = 'dark' | 'warning'
type ToastPosition = 'center' | 'top'

interface ToastProps {
  visible: boolean
  variant?: ToastVariant
  icon?: React.ReactNode
  children: React.ReactNode
  /** 'center' pins the pill at the viewport midpoint (used for
   *  blocking / "please wait" messages). 'top' keeps the existing
   *  near-top banner placement — pass `top` to override the offset. */
  position?: ToastPosition
  top?: string
}

export default function Toast({
  visible,
  variant = 'dark',
  icon,
  children,
  position = 'top',
  top = 'top-16',
}: ToastProps) {
  if (!visible) return null

  const posClass = position === 'center' ? 'toast-pill--centered' : top

  return createPortal(
    <div
      className={`toast-pill toast-pill-${variant} ${posClass}`}
      role="status"
      aria-live="polite"
    >
      {icon}
      <span>{children}</span>
    </div>,
    document.body,
  )
}
