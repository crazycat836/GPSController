import React from 'react'
import { Gamepad2 } from 'lucide-react'
import { useT } from '../../i18n'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function JoystickPanel() {
  const t = useT()
  return (
    <div className="space-y-3">
      <SpeedControls />
      <ActionButtons />
      <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-white/5 text-[var(--color-text-3)] text-xs">
        <Gamepad2 className="w-4 h-4 shrink-0" />
        <span>{t('panel.joystick_hint' as any)}</span>
      </div>
    </div>
  )
}
