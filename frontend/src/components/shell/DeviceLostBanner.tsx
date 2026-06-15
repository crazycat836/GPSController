import { useEffect, useState } from 'react'
import { Unplug, X } from 'lucide-react'
import { useConnectionHealth } from '../../contexts/ConnectionHealthContext'
import { useT } from '../../i18n'

interface DeviceLostBannerProps {
  /** Opens the device panel so the user can reconnect. */
  onOpenDevices: () => void
}

// Persistent banner for an involuntary device disconnect (USB unplugged,
// tunnel died, DVT exhausted). The cause-specific toast fired at the moment
// of loss is easy to miss; this stays up — with a Reconnect shortcut and a
// dismiss — until the device returns (health.hint clears) or the user closes
// it. Rendered as a flow child of TopCenterStack. Mutually exclusive with the
// WS banner: `hint` carries the single most urgent condition, and a WS outage
// outranks device loss, so the two never both show.
export default function DeviceLostBanner({ onOpenDevices }: DeviceLostBannerProps) {
  const { hint } = useConnectionHealth()
  const t = useT()
  const [dismissed, setDismissed] = useState(false)

  // Reset the dismissal once the device recovers, so a *future* loss re-shows
  // the banner instead of staying permanently hidden.
  useEffect(() => {
    if (hint !== 'device_lost') setDismissed(false)
  }, [hint])

  if (hint !== 'device_lost' || dismissed) return null

  return (
    <div role="alert" aria-live="assertive" className="conn-banner is-stacked" data-variant="offline">
      <Unplug className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
      <span>{t('conn.device_lost_title')}</span>
      <button
        type="button"
        onClick={onOpenDevices}
        className="ml-1 inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold cursor-pointer transition-colors"
        style={{ background: 'rgba(255,255,255,0.14)', color: 'inherit' }}
      >
        {t('conn.open_devices')}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('conn.dismiss')}
        title={t('conn.dismiss')}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" strokeWidth={2.5} />
      </button>
    </div>
  )
}
