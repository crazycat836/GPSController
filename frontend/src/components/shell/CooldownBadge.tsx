import { Timer } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useT } from '../../i18n'
import Toast from './Toast'

export default function CooldownBadge() {
  const { cooldown, cooldownEnabled } = useSimContext()
  const t = useT()

  if (!cooldownEnabled || cooldown <= 0) return null

  const total = Math.round(cooldown)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60

  const display = hrs > 0
    ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins}:${secs.toString().padStart(2, '0')}`

  return (
    <Toast
      visible
      variant="warning"
      icon={<Timer className="w-4 h-4" />}
    >
      {t('status.cooldown_badge', { t: display })}
    </Toast>
  )
}
