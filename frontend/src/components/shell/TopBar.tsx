import React from 'react'

interface TopBarProps {
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
}

export default function TopBar({ leftContent, rightContent }: TopBarProps) {
  return (
    <div className="fixed top-3 left-3 right-3 z-[var(--z-ui)] flex items-center justify-between pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2">
        {leftContent}
      </div>
      <div className="pointer-events-auto">
        {rightContent}
      </div>
    </div>
  )
}
