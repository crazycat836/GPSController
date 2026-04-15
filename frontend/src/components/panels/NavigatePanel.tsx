import React from 'react'
import { MousePointerClick } from 'lucide-react'
import { useT } from '../../i18n'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function NavigatePanel() {
  const t = useT()
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-xs">
        <MousePointerClick className="w-4 h-4 shrink-0" />
        <span>{t('panel.navigate_hint' as any)}</span>
      </div>
      <SpeedControls />
      <ActionButtons />
    </div>
  )
}
