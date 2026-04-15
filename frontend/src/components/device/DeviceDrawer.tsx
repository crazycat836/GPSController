import React, { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Wifi, Usb, Search, ChevronDown, Loader2, Check, XCircle,
  CircleSlash, Smartphone, RotateCcw, HelpCircle,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { wifiTunnelDiscover, wifiRepair } from '../../services/api'
import { useT } from '../../i18n'

interface DeviceDrawerProps {
  open: boolean
  onClose: () => void
}

export default function DeviceDrawer({ open, onClose }: DeviceDrawerProps) {
  const t = useT()
  const device = useDeviceContext()
  const { showToast } = useToastContext()

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<number | null>(null)
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const devicesRef = useRef(device.devices)
  devicesRef.current = device.devices

  // WiFi tunnel state
  const [wifiExpanded, setWifiExpanded] = useState(false)
  const [tunnelIp, setTunnelIp] = useState(() => localStorage.getItem('locwarp.tunnel.ip') || '')
  const [tunnelPort, setTunnelPort] = useState(() => localStorage.getItem('locwarp.tunnel.port') || '49152')
  const [tunnelConnecting, setTunnelConnecting] = useState(false)
  const [tunnelError, setTunnelError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [showIpHelp, setShowIpHelp] = useState(false)

  // Repair state
  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairState, setRepairState] = useState<'idle' | 'running' | 'success' | 'failed'>('idle')
  const [repairMessage, setRepairMessage] = useState('')

  useEffect(() => () => {
    if (scanTimer.current) clearTimeout(scanTimer.current)
  }, [])

  const handleScan = useCallback(async () => {
    if (scanTimer.current) clearTimeout(scanTimer.current)
    setScanning(true)
    setScanResult(null)
    try {
      await device.scan()
    } finally {
      setScanning(false)
      setScanResult(devicesRef.current.length)
      scanTimer.current = setTimeout(() => setScanResult(null), 2000)
    }
  }, [device])

  const handleDiscover = useCallback(async () => {
    setDiscovering(true)
    setTunnelError(null)
    try {
      const res = await wifiTunnelDiscover()
      const first = res?.devices?.[0]
      if (first) {
        setTunnelIp(first.ip)
        setTunnelPort(String(first.port))
      } else {
        setTunnelError(t('wifi.device_not_detected'))
      }
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : t('wifi.detect_failed'))
    } finally {
      setDiscovering(false)
    }
  }, [t])

  const handleTunnelConnect = useCallback(async () => {
    if (!tunnelIp.trim()) return
    setTunnelConnecting(true)
    setTunnelError(null)
    try {
      await device.startWifiTunnel(tunnelIp.trim(), parseInt(tunnelPort) || 49152)
      localStorage.setItem('locwarp.tunnel.ip', tunnelIp.trim())
      localStorage.setItem('locwarp.tunnel.port', tunnelPort || '49152')
      showToast('WiFi tunnel connected')
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : 'WiFi tunnel failed')
    } finally {
      setTunnelConnecting(false)
    }
  }, [tunnelIp, tunnelPort, device, showToast])

  const handleRepair = useCallback(async () => {
    setRepairState('running')
    setRepairMessage('')
    try {
      const res = await wifiRepair()
      setRepairState('success')
      setRepairMessage(`${res.name || 'iPhone'} (iOS ${res.ios_version})`)
    } catch (err: unknown) {
      setRepairState('failed')
      setRepairMessage(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [])

  const selectedUdid = device.connectedDevice?.udid

  const inputClass = [
    'flex-1 px-3 py-1.5 rounded-lg text-xs font-mono',
    'bg-black/30 border border-[var(--color-border)]',
    'text-[var(--color-text-1)] outline-none',
    'focus:border-[var(--color-accent)] transition-colors',
  ].join(' ')

  return createPortal(
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[999] bg-black/30 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={[
          'fixed inset-y-0 left-0 w-80 z-[1000]',
          'bg-[var(--color-glass-heavy)] backdrop-blur-2xl',
          'border-r border-[var(--color-border)]',
          'flex flex-col',
          'transform transition-transform duration-[280ms] ease-[var(--ease-out-expo)]',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-1)]">Devices</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scan button */}
        <div className="px-4 pt-3 pb-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className={[
              'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium',
              'bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40',
              'text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 transition-colors cursor-pointer',
              scanning ? 'opacity-70' : '',
            ].join(' ')}
          >
            {scanning ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('device.scan_scanning')}</>
            ) : scanResult != null && scanResult > 0 ? (
              <><Check className="w-3.5 h-3.5 text-green-400" /> <span className="text-green-400">{t('device.scan_found', { n: scanResult })}</span></>
            ) : scanResult === 0 ? (
              <><XCircle className="w-3.5 h-3.5 text-red-400" /> <span className="text-red-400">{t('device.scan_none')}</span></>
            ) : (
              <><Search className="w-3.5 h-3.5" /> USB</>
            )}
          </button>
        </div>

        {/* Device list */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {device.devices.length === 0 && (
            <p className="text-xs text-[var(--color-text-3)] text-center py-6 opacity-60">
              No device
            </p>
          )}

          {device.devices.map((d) => {
            const major = parseInt((d.ios_version || '0').split('.')[0], 10) || 0
            const unsupported = major > 0 && major < 17
            const isSelected = d.udid === selectedUdid

            return (
              <button
                key={d.udid}
                onClick={() => { if (!unsupported) device.connect(d.udid) }}
                disabled={unsupported}
                className={[
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-left transition-colors',
                  isSelected
                    ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30'
                    : 'hover:bg-white/[0.05] border border-transparent',
                  unsupported ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
                title={unsupported ? t('device.ios_unsupported_label', { version: d.ios_version }) : d.name}
              >
                {unsupported
                  ? <CircleSlash className="w-4 h-4 text-red-400 shrink-0" />
                  : <Smartphone className="w-4 h-4 text-[var(--color-text-3)] shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className={[
                    'text-xs truncate',
                    isSelected ? 'font-semibold text-[var(--color-text-1)]' : 'text-[var(--color-text-2)]',
                  ].join(' ')}>
                    {d.name}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {unsupported ? (
                      <span className="text-[10px] text-red-400">
                        {t('device.ios_unsupported_label', { version: d.ios_version })}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[var(--color-text-3)]">iOS {d.ios_version}</span>
                    )}
                    {d.connection_type && !unsupported && (
                      <span className={[
                        'inline-flex items-center gap-1 text-[9px] px-1.5 py-px rounded',
                        d.connection_type === 'Network'
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
                      ].join(' ')}>
                        {d.connection_type === 'Network'
                          ? <Wifi className="w-2.5 h-2.5" />
                          : <Usb className="w-2.5 h-2.5" />}
                        {d.connection_type === 'Network' ? 'WiFi' : 'USB'}
                      </span>
                    )}
                  </div>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />}
              </button>
            )
          })}

          {/* WiFi Tunnel section */}
          <div className="border-t border-[var(--color-border)] mt-2 pt-2">
            <button
              onClick={() => setWifiExpanded((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-[var(--color-text-2)] hover:text-[var(--color-text-1)] transition-colors py-1 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Wifi className="w-3.5 h-3.5" />
                <div className="text-left">
                  <div>{t('wifi.section_title')}</div>
                  <div className="text-[10px] text-[var(--color-text-3)]">{t('wifi.section_hint')}</div>
                </div>
                {device.tunnelStatus.running && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    Active
                  </span>
                )}
              </div>
              <ChevronDown className={[
                'w-3.5 h-3.5 transition-transform',
                wifiExpanded ? 'rotate-180' : '',
              ].join(' ')} />
            </button>

            {wifiExpanded && (
              <div className="mt-2 flex flex-col gap-2">
                {/* Repair button */}
                <button
                  onClick={() => { setRepairState('idle'); setRepairMessage(''); setShowRepairConfirm(true) }}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] rounded-lg border border-amber-400/35 bg-amber-400/8 text-amber-400 hover:bg-amber-400/15 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('wifi.repair_button')}
                </button>

                {/* Help + discover row */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowIpHelp((v) => !v)}
                    className="flex-1 py-1 text-[10px] rounded border border-white/15 bg-white/[0.04] text-[var(--color-text-3)] hover:bg-white/[0.08] transition-colors cursor-pointer"
                  >
                    {t('wifi.help_ip')}
                  </button>
                  <button
                    onClick={handleDiscover}
                    disabled={discovering || device.tunnelStatus.running}
                    className="flex-1 py-1 text-[10px] rounded border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/12 text-[var(--color-accent)] flex items-center justify-center gap-1 hover:bg-[var(--color-accent)]/20 transition-colors cursor-pointer"
                  >
                    <Search className={['w-2.5 h-2.5', discovering ? 'animate-spin' : ''].join(' ')} />
                    {discovering ? t('wifi.detect_scanning') : t('wifi.detect')}
                  </button>
                </div>

                {showIpHelp && (
                  <div className="text-[11px] p-2.5 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/8 leading-relaxed">
                    <div className="font-semibold mb-1 text-[var(--color-accent)]">{t('wifi.help_title')}</div>
                    <div className="text-[var(--color-text-2)] opacity-85">{t('wifi.help_steps')}</div>
                    <div className="text-[10px] opacity-60 mt-1.5">{t('wifi.help_hint')}</div>
                  </div>
                )}

                {/* Tunnel connect / status */}
                {device.tunnelStatus.running ? (
                  <div>
                    <div className="text-[11px] text-[var(--color-text-3)] p-2 rounded bg-green-500/8 mb-2">
                      <div>RSD: {device.tunnelStatus.rsd_address}:{device.tunnelStatus.rsd_port}</div>
                      <div className="text-[10px] opacity-60 mt-0.5">{t('wifi.tunnel_usb_can_disconnect')}</div>
                    </div>
                    <button
                      onClick={() => device.stopTunnel()}
                      className="w-full py-1.5 text-[11px] rounded-lg border border-red-400/40 text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                    >
                      {t('wifi.tunnel_stop')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 text-[var(--color-text-3)]">IP</span>
                      <input
                        type="text"
                        placeholder={t('wifi.ip_placeholder')}
                        value={tunnelIp}
                        onChange={(e) => setTunnelIp(e.target.value)}
                        disabled={tunnelConnecting}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 text-[var(--color-text-3)]">Port</span>
                      <input
                        type="text"
                        placeholder="49152"
                        value={tunnelPort}
                        onChange={(e) => setTunnelPort(e.target.value)}
                        disabled={tunnelConnecting}
                        className={inputClass}
                      />
                    </label>
                    <button
                      onClick={handleTunnelConnect}
                      disabled={tunnelConnecting || !tunnelIp.trim()}
                      className={[
                        'w-full py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer',
                        'bg-[var(--color-accent)] text-white hover:opacity-90',
                        (tunnelConnecting || !tunnelIp.trim()) ? 'opacity-60' : '',
                      ].join(' ')}
                    >
                      {tunnelConnecting ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {t('wifi.tunnel_establishing')}
                        </span>
                      ) : t('wifi.tunnel_start')}
                    </button>
                    {tunnelError && (
                      <p className="text-[11px] text-red-400 p-2 rounded bg-red-400/10 border border-red-400/30">
                        {tunnelError}
                      </p>
                    )}
                    <p className="text-[10px] text-[var(--color-text-3)] opacity-40">{t('wifi.tunnel_admin_hint')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Repair confirm modal */}
      {showRepairConfirm && createPortal(
        <div
          onClick={() => { if (repairState !== 'running') setShowRepairConfirm(false) }}
          className="fixed inset-0 z-[2000] bg-black/55 backdrop-blur-sm flex items-center justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={[
              'w-[420px] p-6 rounded-xl',
              'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
              'shadow-[0_20px_60px_rgba(12,18,40,0.65)]',
              'text-[var(--color-text-1)]',
            ].join(' ')}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/50 flex items-center justify-center text-[var(--color-accent)]">
                <RotateCcw className="w-4 h-4" />
              </div>
              <h3 className="text-[15px] font-semibold">{t('wifi.repair_confirm_title')}</h3>
            </div>

            {repairState === 'idle' && (
              <>
                <p className="text-[13px] leading-relaxed whitespace-pre-line opacity-90 mb-5">
                  {t('wifi.repair_confirm_body')}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowRepairConfirm(false)}
                    className="px-4 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-3)] hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    {t('wifi.repair_cancel')}
                  </button>
                  <button
                    onClick={handleRepair}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    {t('wifi.repair_ok')}
                  </button>
                </div>
              </>
            )}

            {repairState === 'running' && (
              <div className="text-center py-6">
                <Loader2 className="w-8 h-8 mx-auto mb-3 text-[var(--color-accent)] animate-spin" />
                <p className="text-amber-400 text-sm">{t('wifi.repair_running')}</p>
              </div>
            )}

            {repairState === 'success' && (
              <>
                <p className="text-green-400 text-[13px] leading-relaxed">{t('wifi.repair_success')}</p>
                {repairMessage && <p className="text-xs text-[var(--color-text-3)] mt-2">{repairMessage}</p>}
                <div className="flex justify-end mt-5">
                  <button
                    onClick={() => setShowRepairConfirm(false)}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    {t('wifi.warning_ok')}
                  </button>
                </div>
              </>
            )}

            {repairState === 'failed' && (
              <>
                <p className="text-red-400 text-[13px] leading-relaxed">{t('wifi.repair_failed')}</p>
                {repairMessage && (
                  <p className="text-xs text-[var(--color-text-2)] mt-2 p-2 rounded bg-red-400/8 border border-red-400/30 whitespace-pre-wrap break-words">
                    {repairMessage}
                  </p>
                )}
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setShowRepairConfirm(false)}
                    className="px-4 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-3)] hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    {t('wifi.repair_cancel')}
                  </button>
                  <button
                    onClick={handleRepair}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    {t('wifi.repair_ok')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>,
    document.body,
  )
}
