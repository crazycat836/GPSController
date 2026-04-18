import React from 'react'

interface TopBarProps {
  leftContent?: React.ReactNode
  centerContent?: React.ReactNode
  rightContent?: React.ReactNode
}

// Three-slot top bar so brand stays left, search stays centered against
// the map, and actions stay right — mirrors the redesign/Home topbar
// layout (.brand · .search-pill · .top-actions with justify-between).
export default function TopBar({ leftContent, centerContent, rightContent }: TopBarProps) {
  return (
    <div className="fixed top-3 left-3 right-3 z-[var(--z-ui)] flex items-center gap-3 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 shrink-0">
        {leftContent}
      </div>
      {centerContent && (
        <div className="pointer-events-auto flex-1 flex items-center justify-center min-w-0">
          {centerContent}
        </div>
      )}
      {!centerContent && <div className="flex-1" />}
      <div className="pointer-events-auto shrink-0">
        {rightContent}
      </div>
    </div>
  )
}
