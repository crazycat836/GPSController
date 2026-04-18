import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Wifi, Usb, Search, Loader2, Check, XCircle,
  CircleSlash, Smartphone, RotateCcw, Power, PlugZap,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { wifiTunnelDiscover, wifiRepair } from '../../services/api'
import { useT } from '../../i18n'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import { DEFAULT_TUNNEL_PORT } from '../../lib/constants'
import { ICON_SIZE } from '../../lib/icons'
import Drawer from '../shell/Drawer'
import ListRow from '../ui/ListRow'
import SectionHeader from '../ui/SectionHeader'
import EmptyState from '../ui/EmptyState'
import CollapsibleSection from '../ui/CollapsibleSection'
import ConfirmDialog from '../ui/ConfirmDialog'

interface DeviceDrawerProps {
  open: boolean
  onClose: () => void
}

type RepairState = 'idle' | 'running' | 'success' | 'failed'

export default function DeviceDrawer({ open, onClose }: DeviceDrawerProps) {
  const t = useT()
  const device = useDeviceContext()
  const { showToast } = useToastContext()

  // ─── Scan state ─────────────────────────────────────────────
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

  // ─── Wi-Fi Tunnel state ─────────────────────────────────────
  const [tunnelIp, setTunnelIp] = useState(() => localStorage.getItem(STORAGE_KEYS.tunnelIp) || '')
  const [tunnelPort, setTunnelPort] = useState(
    () => localStorage.getItem(STORAGE_KEYS.tunnelPort) || String(DEFAULT_TUNNEL_PORT),
  )
  const [tunnelConnecting, setTunnelConnecting] = useState(false)
  const [tunnelError, setTunnelError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [showIpHelp, setShowIpHelp] = useState(false)

  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairState, setRepairState] = useState<RepairState>('idle')
  const [repairMessage, setRepairMessage] = useState('')

  // Auto-expand tunnel section when running or the user has saved an IP.
  const tunnelShouldStartOpen = device.tunnelStatus.running || !!localStorage.getItem(STORAGE_KEYS.tunnelIp)

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
      showToast('Wi-Fi tunnel connected')
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : 'Wi-Fi tunnel failed')
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

  const closeRepairDialog = useCallback(() => {
    if (repairState !== 'running') setShowRepairConfirm(false)
  }, [repairState])

  const selectedUdid = device.connectedDevice?.udid

  // ─── Scan button renderer (right-slot of devices SectionHeader) ─
  const scanButton = (
    <button
      type="button"
      onClick={handleScan}
      disabled={scanning}
      className="action-btn text-[11px]"
      aria-label={t('device.scan_tooltip')}
      title={t('device.scan_tooltip')}
    >
      {scanning ? (
        <>
          <Loader2 width={ICON_SIZE.xs} height={ICON_SIZE.xs} className="animate-spin" />
          {t('device.scan_scanning')}
        </>
      ) : scanResult != null && scanResult > 0 ? (
        <>
          <Check width={ICON_SIZE.xs} height={ICON_SIZE.xs} className="text-[var(--color-success-text)]" />
          <span className="text-[var(--color-success-text)]">
            {t('device.scan_found', { n: scanResult })}
          </span>
        </>
      ) : scanResult === 0 ? (
        <>
          <XCircle width={ICON_SIZE.xs} height={ICON_SIZE.xs} className="text-[var(--color-error-text)]" />
          <span className="text-[var(--color-error-text)]">{t('device.scan_none')}</span>
        </>
      ) : (
        <>
          <Usb width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
          {t('device.scan')}
        </>
      )}
    </button>
  )

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="Devices"
        icon={<Smartphone className="w-4 h-4" />}
        side="left"
        width="w-[min(440px,92vw)]"
      >
        <div className="p-4 flex flex-col gap-3">
          <SectionHeader
            icon={<Smartphone width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
            title={t('panel.devices')}
            count={device.devices.length}
            right={scanButton}
          />

          {/* Device list */}
          {device.devices.length === 0 ? (
            <EmptyState
              icon={<Smartphone width={ICON_SIZE.lg} height={ICON_SIZE.lg} />}
              title={t('device.no_device')}
              help={t('wifi.tunnel_admin_hint')}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {device.devices.map((d) => {
                const major = parseInt((d.ios_version || '0').split('.')[0], 10) || 0
                const unsupported = major > 0 && major < 16
                const isSelected = d.udid === selectedUdid
                const isNetwork = d.connection_type === 'Network'

                const leading = unsupported ? (
                  <CircleSlash
                    width={ICON_SIZE.md}
                    height={ICON_SIZE.md}
                    className="text-[var(--color-error-text)]"
                  />
                ) : (
                  <Smartphone
                    width={ICON_SIZE.md}
                    height={ICON_SIZE.md}
                    className={isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-3)]'}
                  />
                )

                const meta = unsupported ? undefined : (
                  <span
                    className={[
                      'inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded-md',
                      isNetwork
                        ? 'bg-[var(--color-success-dim)] text-[var(--color-success-text)]'
                        : 'bg-[var(--color-accent-dim)] text-[var(--color-accent-strong)]',
                    ].join(' ')}
                  >
                    {isNetwork
                      ? <Wifi width={10} height={10} />
                      : <Usb width={10} height={10} />}
                    {isNetwork ? 'Wi-Fi' : 'USB'}
                  </span>
                )

                const trailing = isSelected ? (
                  <Check
                    width={ICON_SIZE.sm}
                    height={ICON_SIZE.sm}
                    className="text-[var(--color-success-text)]"
                  />
                ) : undefined

                return (
                  <ListRow
                    key={d.udid}
                    as="button"
                    selected={isSelected}
                    disabled={unsupported}
                    onClick={() => { if (!unsupported) device.connect(d.udid) }}
                    aria-label={d.name}
                    leading={leading}
                    title={<span className="truncate">{d.name}</span>}
                    subtitle={
                      unsupported
                        ? (
                          <span className="text-[var(--color-error-text)]">
                            {t('device.ios_unsupported_label', { version: d.ios_version })}
                          </span>
                        )
                        : <span className="font-mono">iOS {d.ios_version}</span>
                    }
                    meta={meta}
                    trailing={trailing}
                  />
                )
              })}
            </div>
          )}

          {/* Wi-Fi Tunnel section */}
          <CollapsibleSection
            title={t('wifi.section_title')}
            subtitle={t('wifi.section_hint')}
            icon={<Wifi width={ICON_SIZE.sm} height={ICON_SIZE.sm} />}
            persistKey="wifi-tunnel.open"
            defaultOpen={tunnelShouldStartOpen}
            trailing={device.tunnelStatus.running ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--color-success-dim)] text-[var(--color-success-text)] inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                {t('wifi.tunnel_active')}
              </span>
            ) : null}
          >
            {device.tunnelStatus.running ? (
              <div className="flex flex-col gap-2">
                <ListRow
                  density="compact"
                  leading={<PlugZap width={ICON_SIZE.sm} height={ICON_SIZE.sm} className="text-[var(--color-success-text)]" />}
                  title={t('wifi.rsd_endpoint')}
                  subtitle={
                    <span className="font-mono">
                      {device.tunnelStatus.rsd_address}:{device.tunnelStatus.rsd_port}
                    </span>
                  }
                />
                <p className="text-[10px] text-[var(--color-text-3)] opacity-80">
                  {t('wifi.tunnel_usb_can_disconnect')}
                </p>
                <button
                  type="button"
                  onClick={() => device.stopTunnel()}
                  className="seg-cta seg-cta-sm seg-cta-danger"
                >
                  <Power width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
                  {t('wifi.tunnel_stop')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowIpHelp((v) => !v)}
                    className="action-btn flex-1 justify-center text-[11px]"
                    aria-expanded={showIpHelp}
                  >
                    {t('wifi.help_ip')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDiscover}
                    disabled={discovering}
                    className="action-btn primary flex-1 justify-center text-[11px]"
                  >
                    <Search
                      width={ICON_SIZE.xs}
                      height={ICON_SIZE.xs}
                      className={discovering ? 'animate-spin' : ''}
                    />
                    {discovering ? t('wifi.detect_scanning') : t('wifi.detect')}
                  </button>
                </div>

                {showIpHelp && (
                  <div className="text-[11px] p-2.5 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent-dim)] leading-relaxed">
                    <div className="font-semibold mb-1 text-[var(--color-accent-strong)]">
                      {t('wifi.help_title')}
                    </div>
                    <div className="text-[var(--color-text-2)]">{t('wifi.help_steps')}</div>
                    <div className="text-[10px] text-[var(--color-text-3)] mt-1.5">
                      {t('wifi.help_hint')}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
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
                  className="seg-cta seg-cta-sm seg-cta-accent"
                >
                  {tunnelConnecting ? (
                    <>
                      <Loader2 width={ICON_SIZE.sm} height={ICON_SIZE.sm} className="animate-spin" />
                      {t('wifi.tunnel_establishing')}
                    </>
                  ) : (
                    <>
                      <PlugZap width={ICON_SIZE.sm} height={ICON_SIZE.sm} />
                      {t('wifi.tunnel_start')}
                    </>
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

                <button
                  type="button"
                  onClick={() => { setRepairState('idle'); setRepairMessage(''); setShowRepairConfirm(true) }}
                  className="action-btn warning w-full justify-center text-[11px] mt-1"
                  title={t('wifi.repair_tooltip')}
                >
                  <RotateCcw width={ICON_SIZE.xs} height={ICON_SIZE.xs} />
                  {t('wifi.repair_button')}
                </button>
              </div>
            )}
          </CollapsibleSection>
        </div>
      </Drawer>

      {/* Repair confirmation / progress dialog */}
      {showRepairConfirm && (
        repairState === 'idle' ? (
          <ConfirmDialog
            open
            title={t('wifi.repair_confirm_title')}
            description={<span className="whitespace-pre-line">{t('wifi.repair_confirm_body')}</span>}
            confirmLabel={t('wifi.repair_ok')}
            cancelLabel={t('wifi.repair_cancel')}
            onConfirm={handleRepair}
            onCancel={closeRepairDialog}
          />
        ) : repairState === 'running' ? (
          <ConfirmDialog
            open
            busy
            title={t('wifi.repair_confirm_title')}
            description={
              <div className="flex flex-col items-center gap-2 py-3">
                <Loader2 width={28} height={28} className="text-[var(--color-accent)] animate-spin" />
                <p className="text-[var(--color-amber-text)] text-sm text-center">
                  {t('wifi.repair_running')}
                </p>
              </div>
            }
            confirmLabel={t('generic.loading')}
            cancelLabel={t('wifi.repair_cancel')}
            onConfirm={() => {}}
            onCancel={closeRepairDialog}
          />
        ) : repairState === 'success' ? (
          <ConfirmDialog
            open
            title={t('wifi.repair_confirm_title')}
            description={
              <>
                <p className="text-[var(--color-success-text)] text-[13px] leading-relaxed">
                  {t('wifi.repair_success')}
                </p>
                {repairMessage && (
                  <p className="text-xs text-[var(--color-text-3)] mt-2">{repairMessage}</p>
                )}
              </>
            }
            confirmLabel={t('wifi.warning_ok')}
            cancelLabel={t('wifi.repair_cancel')}
            onConfirm={closeRepairDialog}
            onCancel={closeRepairDialog}
          />
        ) : (
          <ConfirmDialog
            open
            title={t('wifi.repair_failed')}
            tone="danger"
            description={
              <>
                <p className="text-[var(--color-error-text)] text-[13px] leading-relaxed">
                  {t('wifi.repair_failed')}
                </p>
                {repairMessage && (
                  <p className="text-xs text-[var(--color-text-2)] mt-2 p-2 rounded-lg bg-[var(--color-danger-dim)] border border-[rgba(255,71,87,0.3)] whitespace-pre-wrap break-words">
                    {repairMessage}
                  </p>
                )}
              </>
            }
            confirmLabel={t('wifi.repair_ok')}
            cancelLabel={t('wifi.repair_cancel')}
            onConfirm={handleRepair}
            onCancel={closeRepairDialog}
          />
        )
      )}
    </>
  )
}
