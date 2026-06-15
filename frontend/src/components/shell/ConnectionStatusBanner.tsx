import { Loader2, WifiOff } from 'lucide-react'
import { useConnectionHealth } from '../../contexts/ConnectionHealthContext'
import { useT } from '../../i18n'

// Persistent banner surfaced whenever the backend WebSocket is down. Unlike
// the transient error pill (sim.error), this stays visible until
// `ws === 'open'` again, because the user needs to know that *any*
// device-state shown elsewhere may be stale.
//
// Rendered as a flow child of TopCenterStack (the single top-center manager),
// so it stacks deterministically with the other status pills instead of
// positioning itself.
export default function ConnectionStatusBanner() {
  const { hint } = useConnectionHealth()
  const t = useT()

  if (hint !== 'ws_reconnecting' && hint !== 'ws_offline') return null

  const isOffline = hint === 'ws_offline'
  return (
    <div
      // Offline is a blocking outage — escalate to assertive so screen
      // readers interrupt. Reconnecting is transient; polite is fine.
      role={isOffline ? 'alert' : 'status'}
      aria-live={isOffline ? 'assertive' : 'polite'}
      className="conn-banner is-stacked"
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
    </div>
  )
}
