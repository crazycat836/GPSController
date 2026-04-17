import React from 'react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: React.ReactNode
  help?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

// Calm, centered empty-state — same treatment everywhere so "no results"
// feels considered rather than accidental blank space.
export default function EmptyState({
  icon,
  title,
  help,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={['empty-state', className].filter(Boolean).join(' ')}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {help != null && <div className="empty-state-help">{help}</div>}
      {action != null && <div>{action}</div>}
    </div>
  )
}
