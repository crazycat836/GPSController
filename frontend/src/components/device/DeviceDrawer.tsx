import React, { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Wifi, Usb, Search, ChevronDown, Loader2, Check, XCircle,
  CircleSlash, Smartphone, RotateCcw,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { wifiTunnelDiscover, wifiRepair } from '../../services/api'
import { useT } from '../../i18n'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import { DEFAULT_TUNNEL_PORT } from '../../lib/constants'
import Drawer from '../shell/Drawer'

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

  const [wifiExpanded, setWifiExpanded] = useState(false)
  const [tunnelIp, setTunnelIp] = useState(() => localStorage.getItem(STORAGE_KEYS.tunnelIp) || '')
  const [tunnelPort, setTunnelPort] = useState(() => localStorage.getItem(STORAGE_KEYS.tunnelPort) || String(DEFAULT_TUNNEL_PORT))
  const [tunnelConnecting, setTunnelConnecting] = useState(false)
  const [tunnelError, setTunnelError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [showIpHelp, setShowIpHelp] = useState(false)

  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairState, setRepairState] = useState<'idle' | 'running' | 'success' | 'failed'>('idle')
  const [repairMessage, setRepairMessage] = useState('')

  useEffect(() => () => { if (scanTimer.current) clearTimeout(scanTimer.current) }, [])

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

  const handleDiscover = useCallback(async () => {
    setDiscovering(true)
    setTunnelError(null)
    try {
      const res = await wifiTunnelDiscover()
      const first = res?.devices?.[0]
      if (first) { setTunnelIp(first.ip); setTunnelPort(String(first.port)) }
      else setTunnelError(t('wifi.device_not_detected'))
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : t('wifi.detect_failed'))
    } finally { setDiscovering(false) }
  }, [t])

  const handleTunnelConnect = useCallback(async () => {
    if (!tunnelIp.trim()) return
    setTunnelConnecting(true)
    setTunnelError(null)
    try {
      await device.startWifiTunnel(tunnelIp.trim(), parseInt(tunnelPort) || DEFAULT_TUNNEL_PORT)
      localStorage.setItem(STORAGE_KEYS.tunnelIp, tunnelIp.trim())
      localStorage.setItem(STORAGE_KEYS.tunnelPort, tunnelPort || String(DEFAULT_TUNNEL_PORT))
      showToast('WiFi tunnel connected')
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : 'WiFi tunnel failed')
    } finally { setTunnelConnecting(false) }
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

  return (
    <>
      <Drawer open={open} onClose={onClose} title="Devices" icon={<Smartphone className="w-4 h-4" />} side="left">
        <div className="p-4 flex flex-col gap-3">

          {/* Scan USB */}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="seg-cta seg-cta-sm seg-cta-accent"
          >
            {scanning ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('device.scan_scanning')}</>
            ) : scanResult != null && scanResult > 0 ? (
              <><Check className="w-3.5 h-3.5 text-green-400" /> <span className="text-green-400">{t('device.scan_found', { n: scanResult })}</span></>
            ) : scanResult === 0 ? (
              <><XCircle className="w-3.5 h-3.5 text-red-400" /> <span className="text-red-400">{t('device.scan_none')}</span></>
            ) : (
              <><Usb className="w-3.5 h-3.5" /> USB</>
            )}
          </button>

          {/* Device list */}
          {device.devices.length === 0 ? (
            <p className="text-xs text-[var(--color-text-3)] text-center py-6">No device</p>
          ) : (
            <div className="flex flex-col gap-1.5">
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
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                      isSelected
                        ? 'bg-[var(--color-accent-dim)] border border-[rgba(108,140,255,0.2)]'
                        : 'bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]',
                      unsupported ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    {unsupported
                      ? <CircleSlash className="w-4 h-4 text-red-400 shrink-0" />
                      : <Smartphone className="w-4 h-4 text-[var(--color-text-3)] shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className={`text-[12px] truncate ${isSelected ? 'font-semibold text-[var(--color-text-1)]' : 'text-[var(--color-text-2)]'}`}>
                        {d.name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {unsupported ? (
                          <span className="text-[10px] text-red-400">{t('device.ios_unsupported_label', { version: d.ios_version })}</span>
                        ) : (
                          <span className="text-[10px] text-[var(--color-text-3)]">iOS {d.ios_version}</span>
                        )}
                        {d.connection_type && !unsupported && (
                          <span className={[
                            'inline-flex items-center gap-1 text-[9px] px-1.5 py-px rounded-md',
                            d.connection_type === 'Network' ? 'bg-green-500/15 text-green-400' : 'bg-[var(--color-accent-dim)] text-[var(--color-accent)]',
                          ].join(' ')}>
                            {d.connection_type === 'Network' ? <Wifi className="w-2.5 h-2.5" /> : <Usb className="w-2.5 h-2.5" />}
                            {d.connection_type === 'Network' ? 'WiFi' : 'USB'}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {/* WiFi Tunnel section */}
          <div className="seg">
            <button
              onClick={() => setWifiExpanded((v) => !v)}
              className="seg-row cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors w-full"
            >
              <Wifi className="w-3.5 h-3.5 text-[var(--color-text-3)] shrink-0" />
              <div className="flex-1 text-left min-w-0">
                <div className="text-[12px] text-[var(--color-text-2)]">{t('wifi.section_title')}</div>
                <div className="text-[10px] text-[var(--color-text-3)]">{t('wifi.section_hint')}</div>
              </div>
              {device.tunnelStatus.running && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-green-500/15 text-green-400 flex items-center gap-1 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  Active
                </span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-3)] transition-transform shrink-0 ${wifiExpanded ? 'rotate-180' : ''}`} />
            </button>

            {wifiExpanded && (
              <div className="px-3 pb-3 flex flex-col gap-2">
                {/* Repair */}
                <button
                  onClick={() => { setRepairState('idle'); setRepairMessage(''); setShowRepairConfirm(true) }}
                  className="action-btn warning w-full justify-center text-[11px]"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('wifi.repair_button')}
                </button>

                {/* Help + Discover */}
                <div className="flex gap-2">
                  <button onClick={() => setShowIpHelp((v) => !v)} className="action-btn flex-1 justify-center text-[10px]">
                    {t('wifi.help_ip')}
                  </button>
                  <button
                    onClick={handleDiscover}
                    disabled={discovering || device.tunnelStatus.running}
                    className="action-btn primary flex-1 justify-center text-[10px]"
                  >
                    <Search className={`w-2.5 h-2.5 ${discovering ? 'animate-spin' : ''}`} />
                    {discovering ? t('wifi.detect_scanning') : t('wifi.detect')}
                  </button>
                </div>

                {showIpHelp && (
                  <div className="text-[11px] p-2.5 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent-dim)] leading-relaxed">
                    <div className="font-semibold mb-1 text-[var(--color-accent)]">{t('wifi.help_title')}</div>
                    <div className="text-[var(--color-text-2)]">{t('wifi.help_steps')}</div>
                    <div className="text-[10px] text-[var(--color-text-3)] mt-1.5">{t('wifi.help_hint')}</div>
                  </div>
                )}

                {/* Tunnel connect / status */}
                {device.tunnelStatus.running ? (
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] text-[var(--color-text-3)] p-2 rounded-lg bg-green-500/8">
                      <div>RSD: {device.tunnelStatus.rsd_address}:{device.tunnelStatus.rsd_port}</div>
                      <div className="text-[10px] text-[var(--color-text-3)] mt-0.5">{t('wifi.tunnel_usb_can_disconnect')}</div>
                    </div>
                    <button onClick={() => device.stopTunnel()} className="action-btn danger w-full justify-center text-[11px]">
                      {t('wifi.tunnel_stop')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 text-[var(--color-text-3)]">IP</span>
                      <input type="text" placeholder={t('wifi.ip_placeholder')} value={tunnelIp} onChange={(e) => setTunnelIp(e.target.value)} disabled={tunnelConnecting} className="seg-input flex-1 text-xs font-mono" />
                    </label>
                    <label className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 text-[var(--color-text-3)]">Port</span>
                      <input type="text" placeholder="49152" value={tunnelPort} onChange={(e) => setTunnelPort(e.target.value)} disabled={tunnelConnecting} className="seg-input flex-1 text-xs font-mono" />
                    </label>
                    <button onClick={handleTunnelConnect} disabled={tunnelConnecting || !tunnelIp.trim()} className="seg-cta seg-cta-sm seg-cta-accent mt-1">
                      {tunnelConnecting ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('wifi.tunnel_establishing')}</>
                      ) : t('wifi.tunnel_start')}
                    </button>
                    {tunnelError && <p className="text-[11px] text-red-400 p-2 rounded-lg bg-red-400/10 border border-red-400/30">{tunnelError}</p>}
                    <p className="text-[10px] text-[var(--color-text-3)] opacity-40">{t('wifi.tunnel_admin_hint')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* Repair confirm modal */}
      {showRepairConfirm && createPortal(
        <div onClick={() => { if (repairState !== 'running') setShowRepairConfirm(false) }} className="fixed inset-0 z-[var(--z-modal)] bg-black/55 backdrop-blur-sm flex items-center justify-center">
          <div onClick={(e) => e.stopPropagation()} className="w-[420px] p-6 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] shadow-[var(--shadow-lg)] text-[var(--color-text-1)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-[var(--color-accent-dim)] border border-[rgba(108,140,255,0.3)] flex items-center justify-center text-[var(--color-accent)]">
                <RotateCcw className="w-4 h-4" />
              </div>
              <h3 className="text-[15px] font-semibold">{t('wifi.repair_confirm_title')}</h3>
            </div>

            {repairState === 'idle' && (
              <>
                <p className="text-[13px] leading-relaxed whitespace-pre-line opacity-90 mb-5">{t('wifi.repair_confirm_body')}</p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowRepairConfirm(false)} className="action-btn">{t('wifi.repair_cancel')}</button>
                  <button onClick={handleRepair} className="action-btn primary">{t('wifi.repair_ok')}</button>
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
                  <button onClick={() => setShowRepairConfirm(false)} className="action-btn primary">{t('wifi.warning_ok')}</button>
                </div>
              </>
            )}
            {repairState === 'failed' && (
              <>
                <p className="text-red-400 text-[13px] leading-relaxed">{t('wifi.repair_failed')}</p>
                {repairMessage && <p className="text-xs text-[var(--color-text-2)] mt-2 p-2 rounded-lg bg-red-400/8 border border-red-400/30 whitespace-pre-wrap break-words">{repairMessage}</p>}
                <div className="flex justify-end gap-2 mt-5">
                  <button onClick={() => setShowRepairConfirm(false)} className="action-btn">{t('wifi.repair_cancel')}</button>
                  <button onClick={handleRepair} className="action-btn primary">{t('wifi.repair_ok')}</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
