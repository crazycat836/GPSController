import { createPortal } from 'react-dom'
import { Loader2, WifiOff } from 'lucide-react'
import { useConnectionHealth } from '../../contexts/ConnectionHealthContext'
import { useT } from '../../i18n'

// Persistent top banner surfaced whenever the backend WebSocket is down.
// Unlike the transient ErrorBanner (sim.error), this one stays visible
// until `ws === 'open'` again, because the user needs to know that
// *any* device-state shown elsewhere on screen may be stale.
//
// Rendered via a portal so it floats above the map and all overlays,
// but below the z-toast tier used by command-failure banners.
export default function ConnectionStatusBanner() {
  const { hint } = useConnectionHealth()
  const t = useT()

  if (hint !== 'ws_reconnecting' && hint !== 'ws_offline') return null

  const isOffline = hint === 'ws_offline'
  return createPortal(
    <div
      // Offline is a blocking outage — escalate to assertive so screen
      // readers interrupt. Reconnecting is transient; polite is fine.
      role={isOffline ? 'alert' : 'status'}
      aria-live={isOffline ? 'assertive' : 'polite'}
      className="conn-banner"
      // z just under toast so a command-failure banner can still appear above.
      data-variant={isOffline ? 'offline' : 'reconnecting'}
    >
      {isOffline ? (
        <WifiOff className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
      ) : (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" strokeWidth={2} />
      )}
      <span>{t(isOffline ? 'conn.ws_offline' : 'conn.ws_reconnecting')}</span>
      {isOffline && (
        <span className="opacity-75 hidden sm:inline">· {t('conn.ws_offline_hint')}</span>
      )}
    </div>,
    document.body,
  )
}
