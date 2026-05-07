import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  RotateCcw, FileText, MapPin, Timer, Languages, Layers, Info,
  Sun, ChevronRight, UserCircle2,
} from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useAvatarContext } from '../../contexts/AvatarContext'
import { useI18n, useT, type Lang } from '../../i18n'
import * as api from '../../services/api'
import AvatarPicker from './AvatarPicker'
import Toggle from '../ui/Toggle'
import KebabMenu, { type KebabMenuItem } from '../ui/KebabMenu'
import Modal from '../Modal'
import { AVATAR_PRESETS } from '../../lib/avatars'
import pkg from '../../../package.json'

const APP_VERSION = pkg.version

function formatCooldown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const LAYER_OPTIONS = [
  { key: 'osm', label: 'OSM' },
  { key: 'carto', label: 'Carto' },
  { key: 'esri', label: 'ESRI' },
] as const

interface SettingsMenuProps {
  open: boolean
  onClose: () => void
  layerKey: string
  onLayerChange: (key: string) => void
}

// Glass settings popover derived from redesign/Home #pop-settings.
// Three sections (Actions / Preferences / About) with uppercase
// headers; each row renders a 28px icon tile + label + value/toggle
// + optional chevron to mirror the design's .set-row anatomy.
export default function SettingsMenu({ open, onClose, layerKey, onLayerChange }: SettingsMenuProps) {
  const t = useT()
  const { lang, setLang } = useI18n()
  const { handleRestore, handleOpenLog, cooldown, cooldownEnabled, handleToggleCooldown } = useSimContext()
  const device = useDeviceContext()
  const { showToast } = useToastContext()

  const [initialOpen, setInitialOpen] = useState(false)
  const [initialLat, setInitialLat] = useState('')
  const [initialLng, setInitialLng] = useState('')
  const [initialError, setInitialError] = useState<string | null>(null)
  const [initialBusy, setInitialBusy] = useState(false)

  const popoverRef = useRef<HTMLDivElement>(null)
  const avatarRowRef = useRef<HTMLDivElement>(null)
  const [avatarPickerAnchor, setAvatarPickerAnchor] = useState<DOMRect | null>(null)

  const avatarCtx = useAvatarContext()
  const avatarPresetKey = avatarCtx.current.kind === 'preset' ? avatarCtx.current.key : null
  const avatarPreset = avatarPresetKey
    ? AVATAR_PRESETS.find((p) => p.key === avatarPresetKey) ?? AVATAR_PRESETS[0]
    : null
  const AvatarIcon = avatarPreset?.Icon

  const dualDevice = device.connectedDevices.length >= 2

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-settings-trigger]')) return
      // Keep the popover open while the avatar picker is driving its own
      // outside-click dismissal. Otherwise clicks inside the picker would
      // bubble up and collapse the settings menu behind it.
      if (target.closest('[data-avatar-picker]')) return
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // pointerdown (not mousedown) so the dismissal also fires for touch and
    // pen input — Electron windows running on a touchscreen wouldn't close
    // otherwise. Same `event.target` semantics across all input types.
    document.addEventListener('pointerdown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const handleOpenInitial = useCallback(async () => {
    try {
      const res = await api.getInitialPosition()
      if (res.position) {
        setInitialLat(String(res.position.lat))
        setInitialLng(String(res.position.lng))
      } else {
        setInitialLat('')
        setInitialLng('')
      }
    } catch {
      setInitialLat('')
      setInitialLng('')
    }
    setInitialError(null)
    setInitialOpen(true)
  }, [])

  const handleInitialSave = useCallback(async () => {
    setInitialError(null)
    const latStr = initialLat.trim()
    const lngStr = initialLng.trim()

    if (latStr === '' && lngStr === '') {
      setInitialBusy(true)
      try {
        await api.setInitialPosition(null, null)
        setInitialOpen(false)
      } catch (e: unknown) {
        setInitialError(e instanceof Error ? e.message : 'error')
      } finally {
        setInitialBusy(false)
      }
      return
    }

    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setInitialError(t('status.set_initial_invalid'))
      return
    }

    setInitialBusy(true)
    try {
      await api.setInitialPosition(lat, lng)
      setInitialOpen(false)
      showToast(t('status.set_initial_saved', { lat: lat.toFixed(5), lng: lng.toFixed(5) }))
    } catch (e: unknown) {
      setInitialError(e instanceof Error ? e.message : 'error')
    } finally {
      setInitialBusy(false)
    }
  }, [initialLat, initialLng, t, showToast])

  if (!open && !initialOpen) return null

  return (
    <>
      {/* Popover */}
      {open && (
        <div
          data-fc="popover.settings"
          ref={popoverRef}
          className={[
            'surface-popup',
            'fixed top-16 right-3 w-[300px] z-[var(--z-dropdown)] overflow-hidden',
            'rounded-2xl',
            'anim-scale-in-tl',
          ].join(' ')}
          style={{ transformOrigin: 'top right' }}
        >
          {/* Actions */}
          <Section label={t('settings.title')}>
            <SettingsRow
              icon={<RotateCcw className="w-[14px] h-[14px]" />}
              label={dualDevice ? t('status.restore_all') : t('status.restore')}
              onClick={() => { handleRestore(); onClose() }}
              trailing={<ChevronRight className="w-3 h-3 text-[var(--color-text-3)] opacity-60" />}
            />
            <SettingsRow
              icon={<FileText className="w-[14px] h-[14px]" />}
              label={t('status.open_log')}
              onClick={() => { handleOpenLog(); onClose() }}
              trailing={<ChevronRight className="w-3 h-3 text-[var(--color-text-3)] opacity-60" />}
            />
            <SettingsRow
              icon={<MapPin className="w-[14px] h-[14px]" />}
              label={t('status.set_initial')}
              onClick={() => { handleOpenInitial(); onClose() }}
              trailing={<ChevronRight className="w-3 h-3 text-[var(--color-text-3)] opacity-60" />}
            />
          </Section>

          {/* Preferences */}
          <Section label={t('settings.preferences')}>
            <SettingsRow
              icon={<Timer className="w-[14px] h-[14px]" />}
              label={t('settings.cooldown_label')}
              disabled={dualDevice}
              title={dualDevice ? t('status.cooldown_dual_disabled') : t('status.cooldown_tooltip')}
              trailing={
                <div className="flex items-center gap-2">
                  {cooldown > 0 && (
                    <span className="text-[10px] font-semibold text-[var(--color-amber-text)] bg-[var(--color-amber-dim)] px-1.5 py-0.5 rounded-full font-mono">
                      {formatCooldown(cooldown)}
                    </span>
                  )}
                  <Toggle
                    checked={cooldownEnabled && !dualDevice}
                    onChange={(v) => { if (!dualDevice) handleToggleCooldown(v) }}
                    ariaLabel={t('settings.toggle_cooldown_aria')}
                  />
                </div>
              }
            />

            <ChoiceRow
              icon={<Languages className="w-[14px] h-[14px]" />}
              label={t('settings.language')}
              value={lang === 'zh' ? t('lang.zh_native') : t('lang.en_native')}
              ariaLabel={t('settings.language_aria')}
              items={[
                { id: 'zh', label: t('lang.zh_native'), onSelect: () => setLang('zh' as Lang) },
                { id: 'en', label: t('lang.en_native'), onSelect: () => setLang('en' as Lang) },
              ]}
            />

            <ChoiceRow
              icon={<Layers className="w-[14px] h-[14px]" />}
              label={t('settings.map_layer')}
              value={LAYER_OPTIONS.find((o) => o.key === layerKey)?.label ?? layerKey}
              ariaLabel={t('settings.map_layer')}
              items={LAYER_OPTIONS.map(({ key, label }) => ({
                id: key,
                label,
                onSelect: () => onLayerChange(key),
              }))}
            />

            <SettingsRow
              icon={<Sun className="w-[14px] h-[14px]" />}
              label={t('settings.theme')}
              interactive={false}
              trailing={<span className="font-mono text-[11px] text-[var(--color-text-3)]">{t('settings.theme_dark')}</span>}
            />

            {/* Map Pin Avatar — previously lived in the top-left status pair.
                Moved here so configuration sits where users look for it,
                and the status pair can stay focused on passive status.
                Uses SettingsRow for shape parity with the surrounding rows;
                the wrapping div carries the bounding-rect ref the picker
                anchors against. */}
            <div ref={avatarRowRef}>
              <SettingsRow
                icon={<UserCircle2 className="w-[14px] h-[14px]" />}
                label={t('avatar.picker_title')}
                onClick={() => {
                  const r = avatarRowRef.current?.getBoundingClientRect()
                  if (r) setAvatarPickerAnchor(r)
                }}
                trailing={
                  <span className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-full grid place-items-center bg-white/[0.04] border border-[var(--color-border)] overflow-hidden">
                      {avatarCtx.current.kind === 'custom' && avatarCtx.customDataUrl ? (
                        <img
                          src={avatarCtx.customDataUrl}
                          alt=""
                          width={22}
                          height={22}
                          style={{ borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : AvatarIcon ? (
                        <AvatarIcon className="w-[14px] h-[14px] text-[var(--color-accent-strong)]" strokeWidth={2} />
                      ) : null}
                    </span>
                    <ChevronRight className="w-3 h-3 text-[var(--color-text-3)] opacity-60" />
                  </span>
                }
              />
            </div>
          </Section>

          {/* Privacy / About */}
          <Section label={t('settings.about')}>
            <SettingsRow
              icon={<Info className="w-[14px] h-[14px]" />}
              label={t('settings.version')}
              interactive={false}
              trailing={<span className="font-mono text-[11px] text-[var(--color-text-3)]">v{APP_VERSION}</span>}
            />
          </Section>
        </div>
      )}

      {/* Avatar picker portal — opens anchored to the Settings row,
          dismisses on its own outside-click handling. */}
      {avatarPickerAnchor && (
        <AvatarPicker
          anchor={avatarPickerAnchor}
          onClose={() => setAvatarPickerAnchor(null)}
        />
      )}

      {/* Set Initial Position modal */}
      <Modal
        open={initialOpen}
        onClose={() => setInitialOpen(false)}
        busy={initialBusy}
        ariaLabelledBy="set-initial-position-title"
        dataFc="modal.set-initial-position"
        surfaceClass="surface-popup"
        dialogClassName="text-[var(--color-text-1)]"
        dialogStyle={{ width: 360, padding: 24, borderRadius: 16 }}
        actions={
          <>
            <button
              onClick={() => setInitialOpen(false)}
              disabled={initialBusy}
              className="px-4 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-3)] hover:bg-white/5 transition-colors cursor-pointer"
            >
              {t('generic.cancel')}
            </button>
            <button
              onClick={handleInitialSave}
              disabled={initialBusy}
              className={[
                'px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer',
                'bg-[var(--color-accent)] text-white',
                'hover:opacity-90 transition-opacity',
                initialBusy ? 'opacity-60' : '',
              ].join(' ')}
            >
              {t('generic.save')}
            </button>
          </>
        }
      >
        <h3 id="set-initial-position-title" className="text-[15px] font-semibold mb-2">{t('status.set_initial')}</h3>
        <p className="text-xs text-[var(--color-text-3)] mb-4 leading-relaxed">
          {t('status.set_initial_prompt')}
        </p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={initialLat}
            onChange={(e) => { setInitialLat(e.target.value); setInitialError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !initialBusy) handleInitialSave()
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
            value={initialLng}
            onChange={(e) => { setInitialLng(e.target.value); setInitialError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !initialBusy) handleInitialSave()
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
        {initialError && (
          <p className="text-[var(--color-error-text)] text-[11px] mt-1 mb-2">{initialError}</p>
        )}
      </Modal>
    </>
  )
}

// ─── Subcomponents ──────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2 px-1.5 [&+*]:border-t [&+*]:border-[var(--color-border-subtle)]">
      <div className="px-3 pt-1.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
        {label}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

interface SettingsRowProps {
  icon: React.ReactNode
  label: React.ReactNode
  trailing?: React.ReactNode
  onClick?: () => void
  /** `false` renders the row as presentational (no hover/cursor). */
  interactive?: boolean
  disabled?: boolean
  danger?: boolean
  title?: string
}

function SettingsRow({
  icon, label, trailing, onClick, interactive = true, disabled, danger, title,
}: SettingsRowProps) {
  const Tag = interactive && onClick ? 'button' : 'div'
  return (
    <Tag
      {...(Tag === 'button' ? { type: 'button', onClick, disabled } : {})}
      title={title}
      className={[
        'flex items-center gap-3 px-3 py-[9px] rounded-[9px] text-[13px]',
        'text-[var(--color-text-1)] tracking-[-0.005em]',
        'transition-colors duration-150',
        interactive && onClick && !disabled ? 'hover:bg-white/[0.04] cursor-pointer' : '',
        disabled ? 'opacity-55 cursor-not-allowed' : '',
        danger ? 'text-[var(--color-danger-text)]' : '',
      ].join(' ')}
    >
      <span
        className={[
          'w-7 h-7 rounded-lg grid place-items-center shrink-0 border',
          danger
            ? 'text-[var(--color-danger-text)] border-[rgba(255,71,87,0.3)] bg-[rgba(255,71,87,0.08)]'
            : 'text-[var(--color-text-2)] border-[var(--color-border)] bg-white/[0.04]',
        ].join(' ')}
      >
        {icon}
      </span>
      <span className="flex-1 text-left truncate">{label}</span>
      {trailing != null && <span className="shrink-0">{trailing}</span>}
    </Tag>
  )
}

// ─── Choice row — shared for rows that pick one of N options ──
// Renders the same anatomy as SettingsRow (28px icon tile + label +
// trailing value + chevron), but the trailing chevron signals that
// clicking opens a dropdown. Avoids inline pill rails for cases like
// language / map-layer where design calls for "value + chevron"
// rather than 3 small crammed buttons.

interface ChoiceRowProps {
  icon: React.ReactNode
  label: React.ReactNode
  value: React.ReactNode
  items: KebabMenuItem[]
  ariaLabel?: string
}

function ChoiceRow({ icon, label, value, items, ariaLabel }: ChoiceRowProps) {
  return (
    <KebabMenu
      items={items}
      ariaLabel={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      align="end"
      trigger={
        <button
          type="button"
          className={[
            'flex items-center gap-3 px-3 py-[9px] rounded-[9px] text-[13px]',
            'text-[var(--color-text-1)] tracking-[-0.005em]',
            'hover:bg-white/[0.04] cursor-pointer',
            'transition-colors duration-150 w-full',
          ].join(' ')}
        >
          <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 border text-[var(--color-text-2)] border-[var(--color-border)] bg-white/[0.04]">
            {icon}
          </span>
          <span className="flex-1 text-left truncate">{label}</span>
          <span className="font-mono text-[11px] text-[var(--color-text-3)]">{value}</span>
          <ChevronRight className="w-3 h-3 text-[var(--color-text-3)] opacity-60 shrink-0" />
        </button>
      }
    />
  )
}

