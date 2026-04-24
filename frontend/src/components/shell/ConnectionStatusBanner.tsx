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
      role="status"
      aria-live="polite"
      // z just under toast so a command-failure banner can still appear above.
      className={[
        'fixed top-3 left-1/2 -translate-x-1/2 z-[var(--z-overlay)]',
        'inline-flex items-center gap-2 px-3.5 h-9 rounded-full',
        'text-[12px] font-medium tracking-[-0.005em]',
        'backdrop-blur-[10px] border shadow-lg',
        isOffline
          ? 'bg-[rgba(255,71,87,0.18)] border-[rgba(255,71,87,0.45)] text-[var(--color-error-text)]'
          : 'bg-[rgba(255,178,71,0.18)] border-[rgba(255,178,71,0.45)] text-[var(--color-warning-text,#ffb347)]',
      ].join(' ')}
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
