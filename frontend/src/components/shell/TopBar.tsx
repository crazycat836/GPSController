import React from 'react'

interface TopBarProps {
  leftContent?: React.ReactNode
  centerContent?: React.ReactNode
  rightContent?: React.ReactNode
}

// Three-slot top bar. Uses a 1fr/auto/1fr grid so the center slot sits
// at the viewport midpoint regardless of how wide the brand pill vs.
// the action cluster end up — otherwise a flex layout drifts the
// "center" slot whenever the two sides have different widths, which
// broke alignment with viewport-centred overlays (like the main toast
// under the search pill).
export default function TopBar({ leftContent, centerContent, rightContent }: TopBarProps) {
  return (
    <div
      data-fc="topbar.root"
      className="fixed top-4 left-4 right-4 z-[var(--z-ui)] grid items-center gap-2 pointer-events-none"
      style={{ gridTemplateColumns: '1fr auto 1fr' }}
    >
      <div className="pointer-events-auto flex items-center gap-2 justify-self-start min-w-0">
        {leftContent}
      </div>
      <div className="pointer-events-auto justify-self-center min-w-0">
        {centerContent}
      </div>
      <div className="pointer-events-auto justify-self-end min-w-0">
        {rightContent}
      </div>
    </div>
  )
}
