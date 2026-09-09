import { useCallback, useEffect, useRef, useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useSimState } from '../../contexts/SimContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useT } from '../../i18n'
import type { StringKey } from '../../i18n'
import { revealDeveloperMode } from '../../services/api'

// Persistent, dismissible banner for a failed DDI (Developer Disk Image)
// mount. Replaces the old 10s toast, which the single-slot ToastContext let
// any later toast overwrite — leaving the user with a connected-but-unusable
// device and no explanation. Driven by the one-shot `ddiMissing` signal; a
// fresh mount attempt (ddiMounting) clears a stale failure.
//
// The backend picks the message via `hint_key`. When the cause is the
// iPhone's Developer Mode toggle being off, the banner also offers the
// AMFI "reveal" action so the user can find the toggle in Settings.

const REASON_DEVELOPER_MODE_DISABLED = 'developer_mode_disabled'

// Only keys the backend is known to send; anything else falls back to the
// generic hint so an unexpected value can't render a raw key.
const HINT_KEYS: ReadonlySet<string> = new Set<StringKey>([
  'ddi.missing_hint',
  'ddi.developer_mode_disabled',
])

function resolveHintKey(hintKey: string | undefined, reason: string): StringKey {
  if (hintKey && HINT_KEYS.has(hintKey)) return hintKey as StringKey
  if (reason === REASON_DEVELOPER_MODE_DISABLED) return 'ddi.developer_mode_disabled'
  return 'ddi.missing_hint'
}

export default function DdiFailedBanner() {
  const { ddiMissing, ddiMounting } = useSimState()
  const { showToast } = useToastContext()
  const t = useT()
  const lastTs = useRef(0)
  const [visible, setVisible] = useState(false)
  const [revealing, setRevealing] = useState(false)

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

  const udid = ddiMissing?.udid
  const handleReveal = useCallback(async () => {
    if (!udid) return
    setRevealing(true)
    try {
      await revealDeveloperMode(udid)
      showToast(t('dev_mode.reveal_success'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`${t('dev_mode.reveal_failed')}: ${msg}`)
    } finally {
      setRevealing(false)
    }
  }, [udid, showToast, t])

  if (!visible || !ddiMissing) return null

  const hintKey = resolveHintKey(ddiMissing.hintKey, ddiMissing.reason)
  const showReveal = hintKey === 'ddi.developer_mode_disabled' && !!udid

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
      <span style={{ lineHeight: 1.45 }}>
        {t(hintKey)}
        {showReveal && (
          <>
            {' '}
            <button
              type="button"
              onClick={handleReveal}
              disabled={revealing}
              className="underline underline-offset-2 cursor-pointer disabled:opacity-60 disabled:cursor-default"
            >
              {t('dev_mode.reveal_button')}
            </button>
          </>
        )}
      </span>
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
