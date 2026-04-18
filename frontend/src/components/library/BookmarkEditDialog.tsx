import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, Crosshair } from 'lucide-react'
import type { BookmarkCategory } from '../../hooks/useBookmarks'
import { ICON_SIZE } from '../../lib/icons'
import { useT } from '../../i18n'

export interface BookmarkEditValues {
  name: string
  lat: number
  lng: number
  categoryId: string
  note?: string
}

interface BaseProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: BookmarkEditValues) => void
  categories: readonly BookmarkCategory[]
  /** Current live position (if available); enables "Use current position". */
  currentPosition: { lat: number; lng: number } | null
}

interface CreateProps extends BaseProps {
  mode: 'create'
  initial?: never
}

interface EditProps extends BaseProps {
  mode: 'edit'
  initial: {
    id: string
    name: string
    lat: number
    lng: number
    categoryId: string
    note?: string
  }
}

type Props = CreateProps | EditProps

// Accept "25.033, 121.564" pasted into the lat field and split into lat/lng.
function trySplitLatLng(s: string): [string, string] | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\t ]\s*(-?\d+(?:\.\d+)?)\s*$/)
  return m ? [m[1], m[2]] : null
}

// Unified Add / Edit bookmark dialog.
// - In create mode with a live position, the "Use current position" toggle
//   is ON by default so the coordinate fields lock to live lat/lng.
// - Toggle OFF to hand-type custom coords.
// - In edit mode the toggle is hidden; user always edits explicit coords.
export default function BookmarkEditDialog(props: Props) {
  const t = useT()
  const { open, onClose, onSubmit, categories, currentPosition, mode } = props
  const initial = (mode === 'edit' ? props.initial : undefined)

  const firstCategory = categories[0]?.id ?? 'default'

  const [name, setName] = useState('')
  const [useCurrent, setUseCurrent] = useState(true)
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const [categoryId, setCategoryId] = useState<string>(firstCategory)
  const [note, setNote] = useState('')

  const nameRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)

  // Initialize form state once per open transition. We deliberately ignore
  // `currentPosition` / `initial` / `firstCategory` after the dialog is
  // already open — otherwise a live position update mid-edit would clobber
  // what the user has typed. The "Use current position" toggle's separate
  // effect below handles live-position sync while the checkbox is on.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true
      if (initial) {
        setName(initial.name)
        setUseCurrent(false)
        setLatStr(String(initial.lat))
        setLngStr(String(initial.lng))
        setCategoryId(initial.categoryId || firstCategory)
        setNote(initial.note ?? '')
      } else {
        setName('')
        const canUseCurrent = !!currentPosition
        setUseCurrent(canUseCurrent)
        setLatStr(canUseCurrent ? String(currentPosition!.lat) : '')
        setLngStr(canUseCurrent ? String(currentPosition!.lng) : '')
        setCategoryId(firstCategory)
        setNote('')
      }
      const f = setTimeout(() => nameRef.current?.focus(), 60)
      return () => clearTimeout(f)
    }
    if (!open) wasOpenRef.current = false
  }, [open, initial, firstCategory, currentPosition])

  // When toggling "Use current position" on, lock the inputs to live pos.
  useEffect(() => {
    if (mode === 'edit') return
    if (useCurrent && currentPosition) {
      setLatStr(String(currentPosition.lat))
      setLngStr(String(currentPosition.lng))
    }
  }, [useCurrent, currentPosition, mode])

  const effectiveLat = useCurrent && currentPosition ? currentPosition.lat : parseFloat(latStr)
  const effectiveLng = useCurrent && currentPosition ? currentPosition.lng : parseFloat(lngStr)
  const latValid = Number.isFinite(effectiveLat) && effectiveLat >= -90 && effectiveLat <= 90
  const lngValid = Number.isFinite(effectiveLng) && effectiveLng >= -180 && effectiveLng <= 180
  const canSubmit = name.trim().length > 0 && latValid && lngValid

  const submit = useCallback(() => {
    if (!canSubmit) return
    onSubmit({
      name: name.trim(),
      lat: effectiveLat,
      lng: effectiveLng,
      categoryId,
      note: note.trim() || undefined,
    })
  }, [canSubmit, name, effectiveLat, effectiveLng, categoryId, note, onSubmit])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const title = mode === 'edit' ? t('bm.edit') : t('bm.add')
  const submitLabel = mode === 'edit' ? t('generic.save') : t('generic.add')

  return createPortal(
    <div className="modal-overlay anim-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className="modal-dialog anim-scale-in"
        style={{ width: 360 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title flex items-center gap-2">
          <MapPin width={ICON_SIZE.md} height={ICON_SIZE.md} className="text-[var(--color-accent)]" />
          {title}
        </div>

        <div className="flex flex-col gap-3 mt-2">
          {/* Name */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--color-text-3)]">{t('bm.name_placeholder')}</span>
            <input
              ref={nameRef}
              type="text"
              className="search-input"
              value={name}
              placeholder={t('bm.name_placeholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              style={{ paddingLeft: 10 }}
            />
          </label>

          {/* Use current position toggle — create mode only */}
          {mode === 'create' && (
            <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-2)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useCurrent}
                disabled={!currentPosition}
                onChange={(e) => setUseCurrent(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              <Crosshair width={ICON_SIZE.sm} height={ICON_SIZE.sm} className="text-[var(--color-text-3)]" />
              <span>{t('bm.add_here')}</span>
              {!currentPosition && (
                <span className="text-[10px] text-[var(--color-danger-text)] ml-auto">
                  {t('bm.no_position')}
                </span>
              )}
            </label>
          )}

          {/* Lat / Lng */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--color-text-3)]">
              {t('panel.coord_lat')} / {t('panel.coord_lng')}
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                className="search-input font-mono"
                value={latStr}
                disabled={useCurrent}
                placeholder={t('bm.latlng_placeholder')}
                onChange={(e) => {
                  const v = e.target.value
                  const split = trySplitLatLng(v)
                  if (split) { setLatStr(split[0]); setLngStr(split[1]) }
                  else setLatStr(v)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                style={{ flex: 1, paddingLeft: 10 }}
              />
              <input
                type="text"
                inputMode="decimal"
                className="search-input font-mono"
                value={lngStr}
                disabled={useCurrent}
                placeholder={t('bm.lng_placeholder')}
                onChange={(e) => setLngStr(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                style={{ flex: 1, paddingLeft: 10 }}
              />
            </div>
          </div>

          {/* Category */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--color-text-3)]">{t('bm.category_color')}</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="search-input"
              style={{ paddingLeft: 10 }}
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name === '預設' ? t('bm.default') : cat.name}
                </option>
              ))}
            </select>
          </label>

          {/* Note — optional */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--color-text-3)]">{t('bm.note')}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="search-input"
              style={{ paddingLeft: 10, resize: 'vertical', minHeight: 52 }}
              placeholder="—"
            />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="action-btn" onClick={onClose}>
            {t('generic.cancel')}
          </button>
          <button
            type="button"
            className="action-btn primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
