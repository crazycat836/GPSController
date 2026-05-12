import { useCallback, useEffect, useMemo, useState } from 'react'
import { Locate, Wand2 } from 'lucide-react'
import Modal from '../Modal'
import { useT } from '../../i18n'
import { useToastContext } from '../../contexts/ToastContext'
import { useSimContext } from '../../contexts/SimContext'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import * as api from '../../services/api'

interface GoldDittoDialogProps {
  open: boolean
  onClose: () => void
}

interface StoredAnchor {
  lat: number
  lng: number
}

/**
 * Read the persisted Gold Ditto anchor from localStorage. Returns
 * ``null`` when the entry is missing, malformed, or unreachable (the
 * Electron sandbox occasionally throws on first launch).
 */
function loadAnchor(): StoredAnchor | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.goldDittoAnchor)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed && typeof parsed === 'object'
      && typeof (parsed as Record<string, unknown>).lat === 'number'
      && typeof (parsed as Record<string, unknown>).lng === 'number'
    ) {
      return { lat: (parsed as StoredAnchor).lat, lng: (parsed as StoredAnchor).lng }
    }
  } catch {
    // ignore — fall through to null
  }
  return null
}

function saveAnchor(anchor: StoredAnchor): void {
  try {
    localStorage.setItem(STORAGE_KEYS.goldDittoAnchor, JSON.stringify(anchor))
  } catch {
    // best-effort; the dialog still works for a single session
  }
}

/**
 * Gold Ditto (拉金盆) configuration + one-shot trigger.
 *
 * Workflow the user follows: manually teleport to a Pikmin Bloom gold-
 * flower spot, open the flower bud in-game, wait for the swipe prompt,
 * then press "拉金盆" here. The dialog reads the user's real-position
 * anchor (``A``) from localStorage, calls the backend, and lets the
 * cycle run. ``A`` only needs to be set once.
 */
export default function GoldDittoDialog({ open, onClose }: GoldDittoDialogProps) {
  const t = useT()
  const { showToast } = useToastContext()
  const { sim } = useSimContext()

  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-populate from localStorage each time the dialog opens so the
  // user sees the value they last saved (rather than having to re-type
  // their real-world coordinate every session).
  useEffect(() => {
    if (!open) return
    setError(null)
    const existing = loadAnchor()
    if (existing) {
      setLat(String(existing.lat))
      setLng(String(existing.lng))
    } else {
      setLat('')
      setLng('')
    }
  }, [open])

  // Validate + parse the inputs once per render so both buttons share
  // the same gate. Returns null on invalid input.
  const parsed = useMemo<StoredAnchor | null>(() => {
    const a = parseFloat(lat.trim())
    const b = parseFloat(lng.trim())
    if (!isFinite(a) || !isFinite(b)) return null
    if (a < -90 || a > 90 || b < -180 || b > 180) return null
    return { lat: a, lng: b }
  }, [lat, lng])

  const fillFromCurrent = useCallback(() => {
    const pos = sim.currentPosition
    if (!pos) {
      setError(t('settings.gold_ditto_no_position'))
      return
    }
    setLat(pos.lat.toFixed(6))
    setLng(pos.lng.toFixed(6))
    setError(null)
  }, [sim.currentPosition, t])

  const handleSave = useCallback(() => {
    if (!parsed) {
      setError(t('settings.gold_ditto_invalid'))
      return
    }
    saveAnchor(parsed)
    showToast(t('settings.gold_ditto_saved'))
    onClose()
  }, [parsed, showToast, t, onClose])

  const handleSaveAndPull = useCallback(async () => {
    if (!parsed || busy) return
    setError(null)
    saveAnchor(parsed)
    setBusy(true)
    try {
      await api.goldDittoCycle(parsed.lat, parsed.lng)
      showToast(t('settings.gold_ditto_pulled'))
      onClose()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : ''
      setError(t('settings.gold_ditto_failed', { msg: message }))
    } finally {
      setBusy(false)
    }
  }, [parsed, busy, showToast, t, onClose])

  return (
    <Modal open={open} onClose={onClose} title={t('settings.gold_ditto_title')}>
      <div className="flex flex-col gap-3 p-4 min-w-[320px]">
        <p className="text-[11px] text-[var(--color-text-3)]">
          {t('settings.gold_ditto_help')}
        </p>

        <div className="seg">
          <div className="seg-row">
            <span className="seg-label">{t('panel.coord_lat')}</span>
            <input
              type="text"
              inputMode="decimal"
              className="seg-input flex-1 text-xs"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="35.658034"
            />
          </div>
          <div className="seg-row">
            <span className="seg-label">{t('panel.coord_lng')}</span>
            <input
              type="text"
              inputMode="decimal"
              className="seg-input flex-1 text-xs"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="139.701636"
            />
          </div>
        </div>

        <button
          type="button"
          className="action-btn text-[11px] self-start"
          onClick={fillFromCurrent}
          disabled={!sim.currentPosition}
          title={t('settings.gold_ditto_use_current_hint')}
        >
          <Locate width={12} height={12} />
          {t('settings.gold_ditto_use_current')}
        </button>

        {error && (
          <p className="text-[11px] text-[var(--color-danger-text)]">{error}</p>
        )}

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            className="action-btn text-[11px]"
            onClick={onClose}
          >
            {t('generic.cancel')}
          </button>
          <button
            type="button"
            className="action-btn text-[11px]"
            onClick={handleSave}
            disabled={!parsed}
          >
            {t('generic.save')}
          </button>
          <button
            type="button"
            className="action-btn primary text-[11px]"
            onClick={() => void handleSaveAndPull()}
            disabled={!parsed || busy}
            title={t('settings.gold_ditto_pull_hint')}
          >
            <Wand2 width={12} height={12} />
            {t('settings.gold_ditto_pull')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
