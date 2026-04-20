import React from 'react'
import { useT } from '../../i18n'
import VerticalToolbar, { ToolbarButton, ToolbarDivider } from './VerticalToolbar'

interface MapControlsProps {
  onRecenter: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  canRecenter: boolean
  className?: string
}

export default function MapControls({ onRecenter, onZoomIn, onZoomOut, canRecenter, className }: MapControlsProps) {
  const t = useT()

  return (
    <VerticalToolbar variant="compact" className={className} data-fc="map.controls">
      <ToolbarButton
        variant="square"
        accent={canRecenter}
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        }
        label={t('map.recenter')}
        onClick={onRecenter}
        disabled={!canRecenter}
      />
      <ToolbarDivider variant="compact" />
      <ToolbarButton
        variant="square"
        icon={<span className="text-lg font-light leading-none">+</span>}
        label="Zoom in"
        onClick={onZoomIn}
      />
      <ToolbarDivider variant="compact" />
      <ToolbarButton
        variant="square"
        icon={<span className="text-lg font-light leading-none">&minus;</span>}
        label="Zoom out"
        onClick={onZoomOut}
      />
    </VerticalToolbar>
  )
}
