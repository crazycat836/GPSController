import React from 'react'
import { Gamepad2 } from 'lucide-react'
import { useT } from '../../i18n'
import SpeedControls from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function JoystickPanel() {
  const t = useT()
  return (
    <div className="seg-stack">
      <SpeedControls />
      <ActionButtons />
      <div className="seg-hint">
        <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
        <span>{t('panel.joystick_hint' as any)}</span>
      </div>
    </div>
  )
}
