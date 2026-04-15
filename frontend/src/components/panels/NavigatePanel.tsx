import React from 'react'
import { MousePointerClick } from 'lucide-react'
import { useT } from '../../i18n'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function NavigatePanel() {
  const t = useT()
  return (
    <div className="seg-stack">
      <div className="seg-hint seg-hint-accent">
        <MousePointerClick className="w-3.5 h-3.5 shrink-0" />
        <span>{t('panel.navigate_hint' as any)}</span>
      </div>
      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
