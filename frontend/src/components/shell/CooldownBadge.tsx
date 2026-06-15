import { Timer } from 'lucide-react'
import { useSimSettings } from '../../contexts/SimSettingsContext'
import { useT } from '../../i18n'

// Cooldown countdown pill. Rendered as a flow child of TopCenterStack, so it
// stacks with the other status pills (e.g. a 429 COOLDOWN_ACTIVE error toast)
// instead of overlapping them.
export default function CooldownBadge() {
  const { cooldown, cooldownEnabled } = useSimSettings()
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
    <div className="toast-pill toast-pill-warning is-stacked" role="status" aria-live="polite" data-fc="map.toast.cooldown">
      <Timer className="w-4 h-4" />
      <span>{t('status.cooldown_badge', { t: display })}</span>
    </div>
  )
}
