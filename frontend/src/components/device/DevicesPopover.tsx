import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Smartphone, Wifi, Usb, CircleSlash, Scan, Settings as SettingsIcon, Loader2, Check, XCircle,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useT } from '../../i18n'
import { ICON_SIZE } from '../../lib/icons'

interface DevicesPopoverProps {
  // Null hides the popover. A DOMRect positions it beneath the trigger
  // (typically the top-bar Devices icon button).
  anchor: DOMRect | null
  onClose: () => void
  // Opens the full DeviceDrawer for advanced controls (Wi-Fi tunnel,
  // repair pairing, IP/Port entry).
  onOpenManage: () => void
}

// Compact paired-devices popover anchored to the top-bar Devices button.
// Mirrors the redesign/Home #pop-devices: 340px glass card with a
// Paired devices header, tappable device rows, and a Scan / Manage
// footer. Deep configuration still lives in DeviceDrawer; clicking
// "Manage" (or the Wi-Fi tunnel footer button) opens it.
export default function DevicesPopover({ anchor, onClose, onOpenManage }: DevicesPopoverProps) {
  const t = useT()
  const device = useDeviceContext()
  const panelRef = useRef<HTMLDivElement>(null)

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<number | null>(null)
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const devicesRef = useRef(device.devices)
  devicesRef.current = device.devices

  const handleScan = useCallback(async () => {
    if (scanTimer.current) clearTimeout(scanTimer.current)
    setScanning(true)
    setScanResult(null)
    try { await device.scan() }
    finally {
      setScanning(false)
      setScanResult(devicesRef.current.length)
      scanTimer.current = setTimeout(() => setScanResult(null), 2000)
    }
  }, [device])

  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current) }, [])

  useEffect(() => {
    if (!anchor) return
    const onDown = (e: Event) => {
      const target = e.target as Element | null
      // The click that opened us bubbles to document — ignore it via
      // the setTimeout below, then only close on clicks outside.
      if (target && panelRef.current?.contains(target)) return
      // Don't close when the user clicks another action button that
      // handles the popover itself (e.g. the Manage button inside
      // which then calls onClose after opening the drawer).
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const tid = setTimeout(() => {
      document.addEventListener('pointerdown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(tid)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  if (!anchor) return null

  // Anchor below the trigger, right-align to its right edge — matches
  // the design's `transform-origin: top right` popover behaviour.
  const width = 340
  const gap = 8
  const viewportW = window.innerWidth
  const right = Math.max(8, viewportW - anchor.right)
  const top = anchor.bottom + gap
  const left = Math.max(8, viewportW - right - width)

  const selectedUdid = device.connectedDevice?.udid

  return createPortal(
    <div
      data-fc="popover.devices"
      ref={panelRef}
      role="dialog"
      aria-label={t('device.popover_aria')}
      className={[
        'surface-popup',
        'fixed z-[var(--z-dropdown)] overflow-hidden rounded-2xl',
        'anim-scale-in-tl',
      ].join(' ')}
      style={{ width, left, top, transformOrigin: 'top right' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-[var(--color-border-subtle)]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
          {t('panel.devices')}
        </span>
        <button
          type="button"
          onClick={() => { onClose(); onOpenManage() }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent-strong)] hover:text-[var(--color-accent)] transition-colors"
        >
          <SettingsIcon className="w-3 h-3" />
          {t('device.drawer_title')}
        </button>
      </div>

      {/* Device list */}
      <div className="p-1.5 max-h-[320px] overflow-y-auto scrollbar-thin">
        {device.devices.length === 0 ? (
          <div className="py-10 px-4 text-center text-[12px] text-[var(--color-text-3)]">
            {t('device.no_device')}
          </div>
        ) : (
          device.devices.map((d, idx) => {
            const major = parseInt((d.ios_version || '0').split('.')[0], 10) || 0
            const unsupported = major > 0 && major < 16
            const isSelected = d.udid === selectedUdid
            const isNetwork = d.connection_type === 'Network'
            const letter = idx < 26 ? String.fromCharCode(65 + idx) : (d.name?.[0] ?? '•')

            return (
              <button
                key={d.udid}
                type="button"
                disabled={unsupported}
                onClick={() => {
                  if (unsupported) return
                  device.connect(d.udid)
                  onClose()
                }}
                className={[
                  'grid items-center gap-3 w-full text-left',
                  'px-2.5 py-2.5 rounded-[10px] transition-colors duration-150',
                  isSelected
                    ? 'bg-[var(--color-accent-dim)]'
                    : 'hover:bg-white/[0.04]',
                  unsupported ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
                style={{ gridTemplateColumns: '36px 1fr auto' }}
              >
                {/* Avatar */}
                {unsupported ? (
                  <span
                    className="w-9 h-9 rounded-[10px] grid place-items-center"
                    style={{
                      background: 'rgba(255,71,87,0.08)',
                      border: '1px solid rgba(255,71,87,0.3)',
                      color: 'var(--color-error-text)',
                    }}
                    aria-hidden="true"
                  >
                    <CircleSlash width={ICON_SIZE.md} height={ICON_SIZE.md} />
                  </span>
                ) : (
                  <span
                    className="w-9 h-9 rounded-[10px] grid place-items-center text-white font-semibold text-[14px]"
                    style={{
                      background: isNetwork
                        ? 'linear-gradient(135deg, #4ecdc4, #2aa39b)'
                        : 'linear-gradient(135deg, #3a7cff, #1e50d4)',
                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
                    }}
                    aria-hidden="true"
                  >
                    {letter}
                  </span>
                )}

                {/* Info */}
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[var(--color-text-1)] tracking-[-0.005em] truncate">
                    {d.name}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-text-3)] inline-flex items-center gap-1.5 min-w-0">
                    {isNetwork
                      ? <Wifi width={10} height={10} className="text-[var(--color-success-text)] shrink-0" />
                      : <Usb width={10} height={10} className="text-[var(--color-accent-strong)] shrink-0" />}
                    <span className="truncate">{isNetwork ? 'Wi-Fi' : 'USB'} · iOS {d.ios_version}</span>
                  </div>
                </div>

                {/* Status */}
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] shrink-0"
                  style={{
                    color: unsupported
                      ? 'var(--color-error-text)'
                      : isSelected
                        ? 'var(--color-success-text)'
                        : 'var(--color-text-3)',
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: unsupported
                        ? 'var(--color-danger)'
                        : isSelected
                          ? 'var(--color-success-text)'
                          : 'rgba(255,255,255,0.35)',
                      boxShadow: isSelected && !unsupported
                        ? '0 0 6px var(--color-success-text)'
                        : 'none',
                    }}
                  />
                  {unsupported
                    ? t('device.status_unsupported')
                    : isSelected
                      ? t('device.chip_state_idle')
                      : t('device.status_ready')}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-2 p-2.5 border-t border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className={[
            'flex-1 inline-flex items-center justify-center gap-1.5 h-[34px] rounded-[9px]',
            'text-[12px] font-medium',
            'bg-white/[0.04] border border-[var(--color-border)] text-[var(--color-text-1)]',
            'hover:bg-white/[0.08]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors duration-150',
          ].join(' ')}
        >
          {scanning ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('device.scan_scanning')}</>
          ) : scanResult != null && scanResult > 0 ? (
            <><Check className="w-3.5 h-3.5 text-[var(--color-success-text)]" /> {t('device.scan_found', { n: scanResult })}</>
          ) : scanResult === 0 ? (
            <><XCircle className="w-3.5 h-3.5 text-[var(--color-error-text)]" /> {t('device.scan_none')}</>
          ) : (
            <><Scan className="w-3.5 h-3.5" /> {t('device.scan_tooltip')}</>
          )}
        </button>
        <button
          type="button"
          onClick={() => { onClose(); onOpenManage() }}
          className={[
            'flex-1 inline-flex items-center justify-center gap-1.5 h-[34px] rounded-[9px]',
            'text-[12px] font-semibold',
            'text-[var(--color-surface-0)]',
            'transition-[transform,box-shadow] duration-150',
            'hover:-translate-y-px',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
          ].join(' ')}
          style={{ background: 'var(--color-accent)', boxShadow: 'var(--shadow-glow)' }}
        >
          <Wifi className="w-3.5 h-3.5" />
          {t('device.drawer_title')}
        </button>
      </div>

      <Smartphone className="hidden" aria-hidden="true" />
    </div>,
    document.body,
  )
}
