import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, FileText, MapPin, Timer, Languages, Layers, Info } from 'lucide-react'
import { useSimContext } from '../../contexts/SimContext'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useT } from '../../i18n'
import * as api from '../../services/api'
import LangToggle from '../LangToggle'
import pkg from '../../../package.json'

const APP_VERSION = (pkg as { version: string }).version

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

export default function SettingsMenu({ open, onClose, layerKey, onLayerChange }: SettingsMenuProps) {
  const t = useT()
  const { handleRestore, handleOpenLog, cooldown, cooldownEnabled, handleToggleCooldown } = useSimContext()
  const device = useDeviceContext()
  const { showToast } = useToastContext()

  const [initialOpen, setInitialOpen] = useState(false)
  const [initialLat, setInitialLat] = useState('')
  const [initialLng, setInitialLng] = useState('')
  const [initialError, setInitialError] = useState<string | null>(null)
  const [initialBusy, setInitialBusy] = useState(false)

  const popoverRef = useRef<HTMLDivElement>(null)

  const dualDevice = device.connectedDevices.length >= 2

  // Close popover on outside click — skip clicks on the settings trigger button
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't close if clicking the TopBar settings trigger (it handles its own toggle)
      if (target.closest('[data-settings-trigger]')) return
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
      showToast(t('status.set_initial') + ` (${lat.toFixed(5)}, ${lng.toFixed(5)})`)
    } catch (e: unknown) {
      setInitialError(e instanceof Error ? e.message : 'error')
    } finally {
      setInitialBusy(false)
    }
  }, [initialLat, initialLng, t, showToast])

  const menuRowClass = [
    'flex items-center gap-3.5 w-full px-3.5 py-2.5 rounded-xl text-[13px]',
    'text-[var(--color-text-1)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer',
  ].join(' ')

  const iconClass = 'w-[18px] h-[18px] text-[var(--color-text-2)] shrink-0'

  if (!open && !initialOpen) return null

  return (
    <>
      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className={[
            'fixed top-14 right-3 w-[272px] z-[var(--z-ui)]',
            'surface-popup rounded-2xl',
            'p-2.5 flex flex-col',
          ].join(' ')}
        >
          {/* Actions group */}
          <div className="flex flex-col gap-0.5">
            <button onClick={() => { handleRestore(); onClose() }} className={menuRowClass}>
              <RotateCcw className={iconClass} />
              <span className="flex-1 text-left">{dualDevice ? t('status.restore_all') : t('status.restore')}</span>
            </button>

            <button onClick={() => { handleOpenLog(); onClose() }} className={menuRowClass}>
              <FileText className={iconClass} />
              <span className="flex-1 text-left">{t('status.open_log')}</span>
            </button>

            <button onClick={() => { handleOpenInitial(); onClose() }} className={menuRowClass}>
              <MapPin className={iconClass} />
              <span className="flex-1 text-left">{t('status.set_initial')}</span>
            </button>
          </div>

          {/* Divider */}
          <div className="h-px bg-[var(--color-border)] mx-2 my-1.5" />

          {/* Preferences group */}
          <div className="flex flex-col gap-0.5">
            <label
              className={[
                menuRowClass,
                dualDevice ? 'opacity-55 cursor-not-allowed' : '',
              ].join(' ')}
              title={dualDevice ? t('status.cooldown_dual_disabled') : t('status.cooldown_tooltip')}
            >
              <Timer className={iconClass} />
              <span className="flex-1 text-left">
                {cooldownEnabled ? t('status.cooldown_enabled') : t('status.cooldown_disabled')}
              </span>
              <div className="flex items-center gap-2">
                {cooldown > 0 && (
                  <span className="text-[10px] font-semibold text-[var(--color-amber-text)] bg-[var(--color-amber-dim)] px-1.5 py-0.5 rounded-full">
                    {formatCooldown(cooldown)}
                  </span>
                )}
                <div
                  role="switch"
                  aria-checked={cooldownEnabled && !dualDevice}
                  tabIndex={0}
                  aria-label="Toggle GPS cooldown"
                  className={[
                    'relative w-9 h-5 rounded-full transition-colors',
                    (cooldownEnabled && !dualDevice) ? 'bg-[var(--color-accent)]' : 'bg-white/15',
                  ].join(' ')}
                  onClick={(e) => {
                    if (dualDevice) { e.preventDefault(); return }
                    handleToggleCooldown(!cooldownEnabled)
                  }}
                  onKeyDown={(e) => {
                    if (dualDevice) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleToggleCooldown(!cooldownEnabled)
                    }
                  }}
                >
                  <div
                    className={[
                      'absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-transform',
                      (cooldownEnabled && !dualDevice) ? 'translate-x-[17px]' : 'translate-x-[3px]',
                    ].join(' ')}
                  />
                </div>
              </div>
            </label>

            <div className={menuRowClass}>
              <Languages className={iconClass} />
              <span className="flex-1 text-left">{t('generic.cancel').includes('取消') ? '語言' : 'Language'}</span>
              <LangToggle />
            </div>

            <div className={[menuRowClass, 'cursor-default hover:bg-transparent'].join(' ')}>
              <Layers className={iconClass} />
              <span className="flex-1 text-left">{t('settings.map_layer')}</span>
              <div className="flex items-center gap-1">
                {LAYER_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => onLayerChange(key)}
                    aria-pressed={layerKey === key}
                    className={[
                      'px-2.5 py-1 text-[10px] font-semibold rounded-md transition-colors cursor-pointer',
                      layerKey === key
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-white/10 text-[var(--color-text-2)] hover:bg-white/15',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-[var(--color-border)] mx-2 my-1.5" />

          {/* Info */}
          <div className={[menuRowClass, 'cursor-default hover:bg-transparent'].join(' ')}>
            <Info className={iconClass} />
            <span className="flex-1 text-left">Version</span>
            <span className="text-[11px] font-mono text-[var(--color-text-3)]">v{APP_VERSION}</span>
          </div>
        </div>
      )}

      {/* Set Initial Position modal */}
      {initialOpen && createPortal(
        <div
          onClick={() => { if (!initialBusy) setInitialOpen(false) }}
          className="fixed inset-0 z-[var(--z-modal)] bg-black/55 backdrop-blur-sm flex items-center justify-center"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="set-initial-position-title"
            onClick={(e) => e.stopPropagation()}
            className={[
              'w-[360px] p-6 rounded-2xl',
              'surface-popup',
              'text-[var(--color-text-1)]',
            ].join(' ')}
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
                  if (e.key === 'Enter' && !initialBusy) handleInitialSave()
                  if (e.key === 'Escape' && !initialBusy) setInitialOpen(false)
                }}
                autoFocus
                placeholder="Lat"
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
                  if (e.key === 'Enter' && !initialBusy) handleInitialSave()
                  if (e.key === 'Escape' && !initialBusy) setInitialOpen(false)
                }}
                placeholder="Lng"
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
            <div className="flex justify-end gap-2 mt-4">
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
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
