import { Gauge } from 'lucide-react'
import { useT } from '../../i18n'
import { SpeedPresets } from './SpeedControls'
import ActionButtons from './ActionButtons'

export default function JoystickPanel() {
  const t = useT()
  return (
    <div className="seg-stack">
      {/* Speed mode picker — Walk / Run / Drive presets only.
          Joystick mode does not honor custom km/h or min~max range,
          so those controls are deliberately omitted. */}
      <div className="seg">
        <div className="seg-row seg-row-header">
          <Gauge size={13} className="text-[var(--color-accent)]" />
          <span className="seg-label">{t('panel.speed')}</span>
        </div>
        <SpeedPresets />
      </div>

      <ActionButtons />
    </div>
  )
}
