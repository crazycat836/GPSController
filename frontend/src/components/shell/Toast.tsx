import React from 'react'

type ToastVariant = 'dark' | 'warning'

interface ToastProps {
  visible: boolean
  variant?: ToastVariant
  icon?: React.ReactNode
  children: React.ReactNode
  top?: string
}

export default function Toast({ visible, variant = 'dark', icon, children, top = 'top-16' }: ToastProps) {
  if (!visible) return null

  return (
    <div
      className={`toast-pill toast-pill-${variant} ${top}`}
      role="status"
      aria-live="polite"
    >
      {icon}
      <span>{children}</span>
    </div>
  )
}
