import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check, Loader2, Plus, Scan, Settings as SettingsIcon, XCircle,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useT } from '../../i18n'
import { DeviceAvatar, DeviceInfoColumn, getDeviceMeta } from './deviceRowParts'

// How long the "Found N" / "Not found" pill stays visible after a scan
// completes, before reverting to the default Scan label.
const SCAN_RESULT_VISIBLE_MS = 2000

export interface DeviceListViewProps {
  // Called when a row is tapped and connect is initiated. The orchestrator
  // closes the popover so the user immediately sees the connection apply.
  onClose: () => void
  // Switch the orchestrator to the manage subview.
  onManage: () => void
  // Switch the orchestrator to the add subview.
  onAdd: () => void
}

export default function DeviceListView({ onClose, onManage, onAdd }: DeviceListViewProps) {
  const t = useT()
  const device = useDeviceContext()

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<number | null>(null)
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current) }, [])

  const handleScan = useCallback(async () => {
    if (scanTimer.current) clearTimeout(scanTimer.current)
    setScanning(true)
    setScanResult(null)
    // Consume the awaited list directly — `device.devices` is updated
    // by a setState the React effect commits on the next render, so
    // reading it from a ref in `finally` would yield a stale count for
    // the freshly-scanned devices.
    let count = 0
    try {
      const list = await device.scan()
      count = list.length
    } finally {
      setScanning(false)
      setScanResult(count)
      scanTimer.current = setTimeout(() => setScanResult(null), SCAN_RESULT_VISIBLE_MS)
    }
  }, [device])

  const selectedUdid = device.connectedDevice?.udid
  const activeCount = device.devices.filter((d) => d.is_connected).length

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-[var(--color-border-subtle)]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
          {t('panel.devices')}{' '}
          <span className="font-mono text-[10px] text-[var(--color-text-3)] font-normal tracking-normal">
            ({t('device.scan_found', { n: activeCount })})
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleScan}
            disabled={scanning}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-[var(--color-text-2)] hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
            title={t('device.scan_tooltip')}
          >
            {scanning ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> {t('device.scan_scanning')}</>
            ) : scanResult != null && scanResult > 0 ? (
              <><Check className="w-3 h-3 text-[var(--color-success-text)]" /> {t('device.scan_found', { n: scanResult })}</>
            ) : scanResult === 0 ? (
              <><XCircle className="w-3 h-3 text-[var(--color-error-text)]" /> {t('device.scan_none')}</>
            ) : (
              <><Scan className="w-3 h-3" /> {t('device.scan_tooltip')}</>
            )}
          </button>
          <button
            type="button"
            onClick={onManage}
            disabled={device.devices.length === 0}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-[var(--color-text-2)] hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
          >
            <SettingsIcon className="w-3 h-3" />
            {t('device.popover_manage_label')}
          </button>
        </div>
      </div>

      <div className="p-1.5 max-h-[320px] overflow-y-auto scrollbar-thin">
        {device.devices.length === 0 ? (
          <div className="py-10 px-4 text-center text-[12px] text-[var(--color-text-3)]">
            {t('device.no_device')}
          </div>
        ) : (
          device.devices.map((d, idx) => {
            const meta = getDeviceMeta(d, idx, selectedUdid)
            const { unsupported, isSelected } = meta
            const isLost = device.lostUdids.has(d.udid) && !d.is_connected
            const statusLabel = unsupported
              ? t('device.status_unsupported')
              : isLost
                ? t('device.chip_state_disconnected')
                : isSelected
                  ? t('device.chip_state_idle')
                  : t('device.status_ready')
            const statusColor = unsupported || isLost
              ? 'var(--color-error-text)'
              : isSelected
                ? 'var(--color-success-text)'
                : 'var(--color-text-3)'
            return (
              <button
                key={d.udid}
                type="button"
                disabled={unsupported}
                onClick={() => {
                  if (unsupported) return
                  void device.connect(d.udid)
                  onClose()
                }}
                className={[
                  'grid items-center gap-3 w-full text-left',
                  'px-2.5 py-2.5 rounded-[10px] transition-colors duration-150',
                  isSelected ? 'bg-[var(--color-accent-dim)]' : 'hover:bg-white/[0.04]',
                  unsupported ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
                style={{ gridTemplateColumns: '36px 1fr auto' }}
              >
                <DeviceAvatar meta={meta} />
                <DeviceInfoColumn device={d} meta={meta} />
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] shrink-0"
                  style={{ color: statusColor }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: unsupported || isLost
                        ? 'var(--color-danger)'
                        : isSelected
                          ? 'var(--color-success-text)'
                          : 'rgba(255,255,255,0.35)',
                      boxShadow: isSelected && !unsupported && !isLost
                        ? '0 0 6px var(--color-success-text)'
                        : 'none',
                    }}
                  />
                  {statusLabel}
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className="p-2.5 border-t border-[var(--color-border-subtle)]">
        <button
          type="button"
          onClick={onAdd}
          className="w-full inline-flex items-center justify-center gap-1.5 h-[34px] rounded-[9px] text-[12px] font-semibold text-[var(--color-surface-0)] transition-[transform,box-shadow] duration-150 hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
          style={{ background: 'var(--color-accent)', boxShadow: 'var(--shadow-glow)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {t('device.popover_add_label')}
        </button>
      </div>
    </>
  )
}
