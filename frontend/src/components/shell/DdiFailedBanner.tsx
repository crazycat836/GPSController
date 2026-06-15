import { useEffect, useRef, useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useSimState } from '../../contexts/SimContext'
import { useT } from '../../i18n'

// Persistent, dismissible banner for a failed DDI (Developer Disk Image)
// mount. Replaces the old 10s toast, which the single-slot ToastContext let
// any later toast overwrite — leaving the user with a connected-but-unusable
// device and no explanation. Driven by the one-shot `ddiMissing` signal; a
// fresh mount attempt (ddiMounting) clears a stale failure.
export default function DdiFailedBanner() {
  const { ddiMissing, ddiMounting } = useSimState()
  const t = useT()
  const lastTs = useRef(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!ddiMissing) return
    if (ddiMissing.ts <= lastTs.current) return
    lastTs.current = ddiMissing.ts
    setVisible(true)
  }, [ddiMissing])

  // A new mount attempt (retry / reconnect) clears the stale failure banner.
  useEffect(() => {
    if (ddiMounting) setVisible(false)
  }, [ddiMounting])

  if (!visible) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="conn-banner is-stacked"
      data-variant="offline"
      style={{
        height: 'auto',
        maxWidth: 'min(560px, calc(100vw - 32px))',
        paddingTop: 8,
        paddingBottom: 8,
        whiteSpace: 'normal',
        alignItems: 'flex-start',
      }}
    >
      <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={2} />
      <span style={{ lineHeight: 1.45 }}>{t('ddi.missing_hint')}</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label={t('conn.dismiss')}
        title={t('conn.dismiss')}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full cursor-pointer opacity-70 hover:opacity-100 transition-opacity shrink-0 mt-0.5"
      >
        <X className="w-3 h-3" strokeWidth={2.5} />
      </button>
    </div>
  )
}
