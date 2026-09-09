import React from 'react'
import { Loader2 } from 'lucide-react'
import { ICON_SIZE } from '../../lib/icons'
import { useT } from '../../i18n'

interface EmptyStateProps {
  icon?: React.ReactNode
  title?: React.ReactNode
  /** Initial fetch still in flight — render the shared spinner + copy
   *  instead of flashing the real "empty" state. */
  loading?: boolean
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
  loading,
}: EmptyStateProps) {
  const t = useT()
  if (loading) {
    icon = <Loader2 width={ICON_SIZE.lg} height={ICON_SIZE.lg} className="animate-spin" />
    title = t('generic.loading')
  }
  return (
    <div className={['empty-state', className].filter(Boolean).join(' ')}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {help != null && <div className="empty-state-help">{help}</div>}
      {action != null && <div>{action}</div>}
    </div>
  )
}
