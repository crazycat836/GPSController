import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Smartphone, Wifi, Usb, CircleSlash, Scan, Loader2, Check, XCircle,
  ChevronLeft, Plus, Power, Trash2, Shield, Search, RotateCcw,
  Settings as SettingsIcon, PlugZap,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useT } from '../../i18n'
import { wifiTunnelDiscover, wifiRepair, revealDeveloperMode } from '../../services/api'
import { ICON_SIZE } from '../../lib/icons'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import { DEFAULT_TUNNEL_PORT } from '../../lib/constants'
import ConfirmDialog from '../ui/ConfirmDialog'

interface DevicesPopoverProps {
  // Null hides the popover. A DOMRect positions it beneath the trigger
  // (the top-bar Devices icon button).
  anchor: DOMRect | null
  onClose: () => void
}

type DevView = 'list' | 'manage' | 'add'

// All device flows now live inside this single popover (per the redesign):
// - list   — paired devices + scan + Add-device entry
// - manage — disconnect / forget / reveal-dev-mode per row, repair pairing footer
// - add    — USB scan + Wi-Fi Tunnel form (multi-result auto-detect picker)
//
// The previous DeviceDrawer was deleted; everything it did now sits here.
export default function DevicesPopover({ anchor, onClose }: DevicesPopoverProps) {
  const t = useT()
  const device = useDeviceContext()
  const { showToast } = useToastContext()
  const panelRef = useRef<HTMLDivElement>(null)

  const [view, setView] = useState<DevView>('list')
  // Reset to the list view whenever the popover is re-opened, so it
  // doesn't reappear stuck on a previous nested view.
  useEffect(() => { if (anchor) setView('list') }, [anchor])

  // ─── Scan state (list-view header button) ────────────────────
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<number | null>(null)
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const devicesRef = useRef(device.devices)
  devicesRef.current = device.devices

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

  // ─── Wi-Fi Tunnel (add-view) ─────────────────────────────────
  const [tunnelIp, setTunnelIp] = useState(() => localStorage.getItem(STORAGE_KEYS.tunnelIp) || '')
  const [tunnelPort, setTunnelPort] = useState(
    () => localStorage.getItem(STORAGE_KEYS.tunnelPort) || String(DEFAULT_TUNNEL_PORT),
  )
  const [tunnelConnecting, setTunnelConnecting] = useState(false)
  const [tunnelError, setTunnelError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  // Multi-iPhone picker — populated when /detect returns 2+ hits.
  const [discoverResults, setDiscoverResults] = useState<Array<{ ip: string; port: number; name: string }>>([])

  const handleDiscover = useCallback(async () => {
    setDiscovering(true)
    setTunnelError(null)
    setDiscoverResults([])
    try {
      const res = await wifiTunnelDiscover()
      const list = res?.devices ?? []
      if (list.length === 0) {
        setTunnelError(t('wifi.device_not_detected'))
      } else if (list.length === 1) {
        setTunnelIp(list[0].ip)
        setTunnelPort(String(list[0].port))
      } else {
        setDiscoverResults(list.map((d) => ({ ip: d.ip, port: d.port, name: d.name || d.ip })))
      }
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : t('wifi.detect_failed'))
    } finally {
      setDiscovering(false)
    }
  }, [t])

  const pickDiscoverResult = useCallback((r: { ip: string; port: number }) => {
    setTunnelIp(r.ip)
    setTunnelPort(String(r.port))
    setDiscoverResults([])
  }, [])

  const handleTunnelConnect = useCallback(async () => {
    if (!tunnelIp.trim()) return
    setTunnelConnecting(true)
    setTunnelError(null)
    try {
      await device.startWifiTunnel(tunnelIp.trim(), parseInt(tunnelPort) || DEFAULT_TUNNEL_PORT)
      localStorage.setItem(STORAGE_KEYS.tunnelIp, tunnelIp.trim())
      localStorage.setItem(STORAGE_KEYS.tunnelPort, tunnelPort || String(DEFAULT_TUNNEL_PORT))
      showToast(t('device.tunnel_connected'))
      setView('list')
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : t('device.tunnel_failed'))
    } finally {
      setTunnelConnecting(false)
    }
  }, [tunnelIp, tunnelPort, device, showToast, t])

  // ─── Repair pairing dialog (manage-view footer) ──────────────
  type RepairState = 'idle' | 'running' | 'success' | 'failed'
  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairState, setRepairState] = useState<RepairState>('idle')
  const [repairMessage, setRepairMessage] = useState('')

  const handleRepair = useCallback(async () => {
    setRepairState('running')
    setRepairMessage('')
    try {
      const res = await wifiRepair()
      setRepairState('success')
      setRepairMessage(`${res.name || 'iPhone'} (iOS ${res.ios_version})`)
    } catch (err: unknown) {
      setRepairState('failed')
      setRepairMessage(err instanceof Error ? err.message : t('device.unknown_error'))
    }
  }, [t])

  const closeRepairDialog = useCallback(() => {
    if (repairState === 'running') return
    setShowRepairConfirm(false)
    setRepairState('idle')
    setRepairMessage('')
  }, [repairState])

  // ─── Forget device confirmation ──────────────────────────────
  const [forgetUdid, setForgetUdid] = useState<string | null>(null)
  const [forgetting, setForgetting] = useState(false)

  const handleForget = useCallback(async () => {
    if (!forgetUdid) return
    setForgetting(true)
    try {
      await device.forget(forgetUdid)
      showToast(t('device.forget_confirm_action'))
      setForgetUdid(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(msg)
    } finally {
      setForgetting(false)
    }
  }, [forgetUdid, device, showToast, t])

  // ─── AMFI: Reveal Developer Mode (per-row, USB-only iOS 16+) ─
  const [revealInFlight, setRevealInFlight] = useState<Record<string, boolean>>({})
  const handleRevealDevMode = useCallback(async (udid: string) => {
    setRevealInFlight((prev) => ({ ...prev, [udid]: true }))
    try {
      await revealDeveloperMode(udid)
      showToast(t('dev_mode.reveal_success'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`${t('dev_mode.reveal_failed')}: ${msg}`)
    } finally {
      setRevealInFlight((prev) => {
        const next = { ...prev }
        delete next[udid]
        return next
      })
    }
  }, [showToast, t])

  // ─── Disconnect (per-row in manage view) ─────────────────────
  const [disconnectInFlight, setDisconnectInFlight] = useState<Record<string, boolean>>({})
  const handleDisconnect = useCallback(async (udid: string) => {
    setDisconnectInFlight((prev) => ({ ...prev, [udid]: true }))
    try {
      await device.disconnect(udid)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(msg)
    } finally {
      setDisconnectInFlight((prev) => {
        const next = { ...prev }
        delete next[udid]
        return next
      })
    }
  }, [device, showToast])

  // ─── Outside-click + ESC handling ────────────────────────────
  useEffect(() => {
    if (!anchor) return
    const onDown = (e: Event) => {
      const target = e.target as Element | null
      if (target && panelRef.current?.contains(target)) return
      // Don't close if a modal child dialog has focus.
      if (showRepairConfirm || forgetUdid) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Modal dialogs handle their own ESC.
      if (showRepairConfirm || forgetUdid) return
      // Inner views step back to the list; list view closes.
      if (view !== 'list') setView('list')
      else onClose()
    }
    const tid = setTimeout(() => {
      document.addEventListener('pointerdown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(tid)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose, view, showRepairConfirm, forgetUdid])

  if (!anchor) return null

  // ─── Layout positioning ──────────────────────────────────────
  const width = 360
  const gap = 8
  const viewportW = window.innerWidth
  const right = Math.max(8, viewportW - anchor.right)
  const top = anchor.bottom + gap
  const left = Math.max(8, viewportW - right - width)

  const selectedUdid = device.connectedDevice?.udid

  // ─── Helpers shared between list + manage rows ───────────────
  function deviceMeta(d: typeof device.devices[number], idx: number) {
    const major = parseInt((d.ios_version || '0').split('.')[0], 10) || 0
    const unsupported = major > 0 && major < 16
    const isNetwork = d.connection_type === 'Network'
    const isUsb = d.connection_type === 'USB' || d.connection_type === 'Usbmuxd'
    const isSelected = d.udid === selectedUdid
    const letter = idx < 26 ? String.fromCharCode(65 + idx) : (d.name?.[0] ?? '•')
    return { major, unsupported, isNetwork, isUsb, isSelected, letter }
  }

  function renderAvatar(d: typeof device.devices[number], idx: number) {
    const { unsupported, isNetwork, letter } = deviceMeta(d, idx)
    if (unsupported) {
      return (
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
      )
    }
    return (
      <span
        className="w-9 h-9 rounded-[10px] grid place-items-center text-white font-semibold text-[14px]"
        style={{
          background: `var(${isNetwork ? '--gradient-device-network' : '--gradient-device-usb'})`,
          boxShadow: 'var(--shadow-avatar-ring)',
        }}
        aria-hidden="true"
      >
        {letter}
      </span>
    )
  }

  function renderInfo(d: typeof device.devices[number], idx: number) {
    const { unsupported, isNetwork } = deviceMeta(d, idx)
    return (
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--color-text-1)] tracking-[-0.005em] truncate">
          {d.name}
        </div>
        <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-text-3)] inline-flex items-center gap-1.5 min-w-0">
          {!unsupported && (
            isNetwork
              ? <Wifi width={10} height={10} className="text-[var(--color-success-text)] shrink-0" />
              : <Usb width={10} height={10} className="text-[var(--color-accent-strong)] shrink-0" />
          )}
          <span className="truncate">
            {unsupported
              ? t('device.ios_unsupported_label', { version: d.ios_version })
              : `${isNetwork ? 'Wi-Fi' : 'USB'} · iOS ${d.ios_version}`}
          </span>
        </div>
      </div>
    )
  }

  // ─── List view ──────────────────────────────────────────────
  function renderListView() {
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
              onClick={() => setView('manage')}
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
              const { unsupported, isSelected } = deviceMeta(d, idx)
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
                  {renderAvatar(d, idx)}
                  {renderInfo(d, idx)}
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
            onClick={() => setView('add')}
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

  // ─── Manage view ────────────────────────────────────────────
  function renderManageView() {
    return (
      <>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-[var(--color-border-subtle)]">
          <button
            type="button"
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent-strong)] hover:text-[var(--color-accent)] transition-colors"
          >
            <ChevronLeft className="w-3 h-3" />
            {t('device.popover_back')}
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
            {t('device.popover_manage_title')}
          </span>
        </div>

        <div className="p-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
          {device.devices.length === 0 ? (
            <div className="py-10 px-4 text-center text-[12px] text-[var(--color-text-3)]">
              {t('device.no_device')}
            </div>
          ) : (
            device.devices.map((d, idx) => {
              const { unsupported, isUsb } = deviceMeta(d, idx)
              const canRevealDevMode = !!d.can_reveal_developer_mode
              const revealing = !!revealInFlight[d.udid]
              const disconnecting = !!disconnectInFlight[d.udid]
              const isOnline = d.is_connected
              return (
                <div
                  key={d.udid}
                  className="grid items-center gap-2 w-full px-2 py-2 rounded-[10px]"
                  style={{ gridTemplateColumns: '36px 1fr auto' }}
                >
                  {renderAvatar(d, idx)}
                  {renderInfo(d, idx)}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* AMFI Reveal Dev Mode — only when applicable */}
                    {canRevealDevMode && (
                      <button
                        type="button"
                        onClick={() => handleRevealDevMode(d.udid)}
                        disabled={revealing}
                        title={t('dev_mode.reveal_button')}
                        aria-label={t('dev_mode.reveal_button')}
                        className="w-7 h-7 grid place-items-center rounded-md text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-wait transition-colors"
                      >
                        {revealing
                          ? <Loader2 width={13} height={13} className="animate-spin" />
                          : <Shield width={13} height={13} />}
                      </button>
                    )}
                    {/* Disconnect — only when online + not unsupported */}
                    {isOnline && !unsupported && (
                      <button
                        type="button"
                        onClick={() => void handleDisconnect(d.udid)}
                        disabled={disconnecting}
                        title={t('device.disconnect_tooltip')}
                        aria-label={t('device.disconnect_tooltip')}
                        className="w-7 h-7 grid place-items-center rounded-md text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-wait transition-colors"
                      >
                        {disconnecting
                          ? <Loader2 width={13} height={13} className="animate-spin" />
                          : <Power width={13} height={13} />}
                      </button>
                    )}
                    {/* Forget — always */}
                    <button
                      type="button"
                      onClick={() => setForgetUdid(d.udid)}
                      title={t('device.forget_tooltip')}
                      aria-label={t('device.forget_tooltip')}
                      className="w-7 h-7 grid place-items-center rounded-md text-[var(--color-error-text)]/80 hover:text-[var(--color-error-text)] hover:bg-[var(--color-danger-dim)] transition-colors"
                    >
                      <Trash2 width={13} height={13} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="border-t border-[var(--color-border-subtle)] px-3 py-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { setRepairState('idle'); setRepairMessage(''); setShowRepairConfirm(true) }}
            className="action-btn warning w-full justify-center text-[11px]"
            title={t('wifi.repair_tooltip')}
          >
            <RotateCcw width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
            {t('wifi.repair_button')}
          </button>
          <p className="text-[10.5px] text-[var(--color-text-3)] leading-[1.5]">
            {t('device.popover_manage_note')}
          </p>
        </div>
      </>
    )
  }

  // ─── Add view ───────────────────────────────────────────────
  function renderAddView() {
    return (
      <>
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-[var(--color-border-subtle)]">
          <button
            type="button"
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent-strong)] hover:text-[var(--color-accent)] transition-colors"
          >
            <ChevronLeft className="w-3 h-3" />
            {t('device.popover_back')}
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
            {t('device.popover_add_title')}
          </span>
        </div>

        <div className="px-3.5 pt-3.5 pb-3 flex flex-col gap-4 max-h-[420px] overflow-y-auto scrollbar-thin">
          {/* USB section */}
          <section className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-1)]">
              <Usb width={14} height={14} />
              {t('device.add_via_usb')}
            </div>
            <p className="text-[11px] text-[var(--color-text-3)] leading-[1.5]">
              {t('device.add_via_usb_hint')}
            </p>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="action-btn primary w-full justify-center text-[12px]"
            >
              {scanning ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> {t('device.scan_scanning')}</>
              ) : (
                <><Search className="w-3 h-3" /> {t('device.scan_tooltip')}</>
              )}
            </button>
          </section>

          {/* OR divider */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
            <span className="text-[10.5px] text-[var(--color-text-3)]">{t('device.add_or')}</span>
            <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
          </div>

          {/* Wi-Fi Tunnel section */}
          <section className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-1)]">
              <Wifi width={14} height={14} />
              {t('device.add_via_wifi')}
            </div>
            <p className="text-[11px] text-[var(--color-text-3)] leading-[1.5]">
              {t('device.add_via_wifi_hint')}
            </p>

            <button
              type="button"
              onClick={handleDiscover}
              disabled={discovering}
              className="action-btn w-full justify-center text-[11px]"
            >
              <Search width={11} height={11} className={discovering ? 'animate-spin' : ''} />
              {discovering ? t('wifi.detect_scanning') : t('wifi.detect')}
            </button>

            {discoverResults.length > 0 && (
              <div className="text-[11px] p-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent-dim)]">
                <div className="font-semibold mb-1 text-[var(--color-accent-strong)]">
                  {t('wifi.tunnel_detect_multiple', { n: discoverResults.length })}
                </div>
                <div className="flex flex-col gap-1">
                  {discoverResults.map((r) => (
                    <div
                      key={`${r.ip}:${r.port}`}
                      className="flex items-center gap-2 py-1 border-t border-white/5 first:border-t-0"
                    >
                      <div className="flex-1 min-w-0 truncate">
                        <span className="font-mono text-[var(--color-text-2)]">{r.ip}</span>
                        <span className="ml-2 text-[var(--color-text-3)]">{r.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => pickDiscoverResult(r)}
                        className="action-btn primary text-[10px] px-2 py-0.5"
                      >
                        {t('wifi.tunnel_use_this')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5 mt-1">
              <label className="flex items-center gap-2 text-[11px]">
                <span className="w-10 text-[var(--color-text-3)]">{t('wifi.ip')}</span>
                <input
                  type="text"
                  placeholder={t('wifi.ip_placeholder')}
                  value={tunnelIp}
                  onChange={(e) => setTunnelIp(e.target.value)}
                  disabled={tunnelConnecting}
                  className="seg-input flex-1 text-xs font-mono"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <span className="w-10 text-[var(--color-text-3)]">{t('wifi.port')}</span>
                <input
                  type="text"
                  placeholder="49152"
                  value={tunnelPort}
                  onChange={(e) => setTunnelPort(e.target.value)}
                  disabled={tunnelConnecting}
                  className="seg-input flex-1 text-xs font-mono"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={handleTunnelConnect}
              disabled={tunnelConnecting || !tunnelIp.trim()}
              className="seg-cta seg-cta-sm seg-cta-accent mt-1"
            >
              {tunnelConnecting ? (
                <><Loader2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} className="animate-spin" /> {t('wifi.tunnel_establishing')}</>
              ) : (
                <><PlugZap width={ICON_SIZE.sm} height={ICON_SIZE.sm} /> {t('wifi.tunnel_start')}</>
              )}
            </button>

            {tunnelError && (
              <p className="text-[11px] text-[var(--color-error-text)] p-2 rounded-lg bg-[var(--color-danger-dim)] border border-[rgba(255,71,87,0.3)]">
                {tunnelError}
              </p>
            )}

            <p className="text-[10px] text-[var(--color-text-3)] opacity-70">
              {t('wifi.tunnel_admin_hint')}
            </p>
          </section>
        </div>
      </>
    )
  }

  return createPortal(
    <>
      <div
        data-fc="popover.devices"
        ref={panelRef}
        role="dialog"
        aria-label={t('device.popover_aria')}
        className={['surface-popup', 'fixed z-[var(--z-dropdown)] overflow-hidden rounded-2xl', 'anim-scale-in-tl'].join(' ')}
        style={{ width, left, top, transformOrigin: 'top right' }}
      >
        {view === 'list' && renderListView()}
        {view === 'manage' && renderManageView()}
        {view === 'add' && renderAddView()}

        <Smartphone className="hidden" aria-hidden="true" />
      </div>

      {/* Forget device confirmation */}
      <ConfirmDialog
        open={!!forgetUdid}
        title={t('device.forget_confirm_title')}
        description={t('device.forget_confirm_body')}
        confirmLabel={t('device.forget_confirm_action')}
        cancelLabel={t('generic.cancel')}
        tone="danger"
        busy={forgetting}
        onConfirm={() => void handleForget()}
        onCancel={() => { if (!forgetting) setForgetUdid(null) }}
      />

      {/* Repair pairing dialog (with running/success/failed states) */}
      <ConfirmDialog
        open={showRepairConfirm}
        title={t('wifi.repair_confirm_title')}
        description={
          repairState === 'running' ? t('wifi.repair_running')
            : repairState === 'success' ? `${t('wifi.repair_success')}${repairMessage ? ` — ${repairMessage}` : ''}`
            : repairState === 'failed' ? `${t('wifi.repair_failed')}${repairMessage ? `: ${repairMessage}` : ''}`
            : t('wifi.repair_confirm_body')
        }
        confirmLabel={
          repairState === 'running' ? t('wifi.repair_running')
            : repairState === 'success' ? t('generic.confirm')
            : repairState === 'failed' ? t('generic.confirm')
            : t('wifi.repair_button')
        }
        cancelLabel={t('generic.cancel')}
        tone="default"
        busy={repairState === 'running'}
        onConfirm={() => {
          if (repairState === 'idle') void handleRepair()
          else closeRepairDialog()
        }}
        onCancel={closeRepairDialog}
      />
    </>,
    document.body,
  )
}
