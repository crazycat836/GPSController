import { useCallback, useEffect, useState } from 'react'
import Modal from '../Modal'
import { useT } from '../../i18n'
import { useToastContext } from '../../contexts/ToastContext'
import * as api from '../../services/api'

interface SetInitialPositionDialogProps {
  open: boolean
  onClose: () => void
  /**
   * Optional override for the save action. When omitted, the dialog calls
   * `api.setInitialPosition` directly and emits a success toast — this
   * matches the legacy inline-modal behaviour. Provide a custom handler if
   * the parent needs to intercept (e.g. for tests or alternative storage).
   */
  onSubmit?: (lat: number | null, lng: number | null) => Promise<void>
}

/**
 * Modal for setting the simulator's "initial position" — the coordinate the
 * device returns to when the simulation is reset. Empty inputs clear the
 * stored value. Extracted from `SettingsMenu` so the popover doesn't carry
 * the dialog's state machinery on every render.
 *
 * Lifecycle:
 *   - On open, loads the current value from the backend so the inputs
 *     pre-fill with what's already saved (or stay empty when no value is
 *     stored).
 *   - On save, validates lat/lng ranges and either persists or clears.
 *   - Empty + Save → clear the stored value (legacy behaviour).
 */
export default function SetInitialPositionDialog({
  open,
  onClose,
  onSubmit,
}: SetInitialPositionDialogProps) {
  const t = useT()
  const { showToast } = useToastContext()

  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Pre-populate from the backend each time the dialog opens. Failing the
  // load is non-fatal — fall back to empty inputs so the user can still
  // enter a fresh value.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    ;(async () => {
      try {
        const res = await api.getInitialPosition()
        if (cancelled) return
        if (res.position) {
          setLat(String(res.position.lat))
          setLng(String(res.position.lng))
        } else {
          setLat('')
          setLng('')
        }
      } catch {
        if (!cancelled) {
          setLat('')
          setLng('')
        }
      }
    })()
    return () => { cancelled = true }
  }, [open])

  const handleSave = useCallback(async () => {
    setError(null)
    const latStr = lat.trim()
    const lngStr = lng.trim()

    // Empty + Save → clear the stored initial position.
    if (latStr === '' && lngStr === '') {
      setBusy(true)
      try {
        if (onSubmit) {
          await onSubmit(null, null)
        } else {
          await api.setInitialPosition(null, null)
        }
        onClose()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'error')
      } finally {
        setBusy(false)
      }
      return
    }

    const latNum = parseFloat(latStr)
    const lngNum = parseFloat(lngStr)
    if (
      !isFinite(latNum) || !isFinite(lngNum) ||
      latNum < -90 || latNum > 90 ||
      lngNum < -180 || lngNum > 180
    ) {
      setError(t('status.set_initial_invalid'))
      return
    }

    setBusy(true)
    try {
      if (onSubmit) {
        await onSubmit(latNum, lngNum)
      } else {
        await api.setInitialPosition(latNum, lngNum)
        showToast(t('status.set_initial_saved', {
          lat: latNum.toFixed(5),
          lng: lngNum.toFixed(5),
        }))
      }
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setBusy(false)
    }
  }, [lat, lng, onSubmit, onClose, t, showToast])

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      ariaLabelledBy="set-initial-position-title"
      dataFc="modal.set-initial-position"
      surfaceClass="surface-popup"
      dialogClassName="text-[var(--color-text-1)]"
      dialogStyle={{ width: 360, padding: 24, borderRadius: 16 }}
      actions={
        <>
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-3)] hover:bg-white/5 transition-colors cursor-pointer"
          >
            {t('generic.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className={[
              'px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer',
              'bg-[var(--color-accent)] text-white',
              'hover:opacity-90 transition-opacity',
              busy ? 'opacity-60' : '',
            ].join(' ')}
          >
            {t('generic.save')}
          </button>
        </>
      }
    >
      <h3 id="set-initial-position-title" className="text-[15px] font-semibold mb-2">
        {t('status.set_initial')}
      </h3>
      <p className="text-xs text-[var(--color-text-3)] mb-4 leading-relaxed">
        {t('status.set_initial_prompt')}
      </p>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={lat}
          onChange={(e) => { setLat(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) handleSave()
          }}
          autoFocus
          placeholder={t('settings.lat_placeholder')}
          className={[
            'flex-1 px-3 py-2 rounded-lg font-mono text-sm',
            'bg-black/30 border border-[var(--color-border)]',
            'text-[var(--color-text-1)] outline-none',
            'focus:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] transition-colors',
          ].join(' ')}
        />
        <input
          type="text"
          value={lng}
          onChange={(e) => { setLng(e.target.value); setError(null) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) handleSave()
          }}
          placeholder={t('settings.lng_placeholder')}
          className={[
            'flex-1 px-3 py-2 rounded-lg font-mono text-sm',
            'bg-black/30 border border-[var(--color-border)]',
            'text-[var(--color-text-1)] outline-none',
            'focus:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] transition-colors',
          ].join(' ')}
        />
      </div>
      {error && (
        <p className="text-[var(--color-error-text)] text-[11px] mt-1 mb-2">{error}</p>
      )}
    </Modal>
  )
}
