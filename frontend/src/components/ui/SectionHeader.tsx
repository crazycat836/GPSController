import React from 'react'

interface SectionHeaderProps {
  icon?: React.ReactNode
  title: React.ReactNode
  count?: number
  right?: React.ReactNode
  className?: string
}

// Uppercase label strip used above list sections.
// Right slot accepts any action (button / kebab / link).
export default function SectionHeader({
  icon,
  title,
  count,
  right,
  className,
}: SectionHeaderProps) {
  return (
    <div className={['panel-section-header', className].filter(Boolean).join(' ')}>
      {icon && <span className="panel-section-header-icon">{icon}</span>}
      <span>{title}</span>
      {typeof count === 'number' && (
        <span className="panel-section-header-count">({count})</span>
      )}
      {right != null && <span className="panel-section-header-right">{right}</span>}
    </div>
  )
}
