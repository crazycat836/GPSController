import { useCallback, useState } from 'react'
import {
  Wifi, Usb, Search, Loader2,
  Smartphone, RotateCcw, Power, PlugZap,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { wifiTunnelDiscover, wifiRepair, revealDeveloperMode } from '../../services/api'
import { useT } from '../../i18n'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import { DEFAULT_TUNNEL_PORT } from '../../lib/constants'
import { ICON_SIZE } from '../../lib/icons'
import Drawer from '../shell/Drawer'
import ListRow from '../ui/ListRow'
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

  // ─── Wi-Fi Tunnel state ─────────────────────────────────────
  const [tunnelIp, setTunnelIp] = useState(() => localStorage.getItem(STORAGE_KEYS.tunnelIp) || '')
  const [tunnelPort, setTunnelPort] = useState(
    () => localStorage.getItem(STORAGE_KEYS.tunnelPort) || String(DEFAULT_TUNNEL_PORT),
  )
  const [tunnelConnecting, setTunnelConnecting] = useState(false)
  const [tunnelError, setTunnelError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  // When auto-detect finds 2+ iPhones we surface a picker instead of
  // silently applying the first hit.
  const [discoverResults, setDiscoverResults] = useState<Array<{ ip: string; port: number; name: string }>>([])
  const [showIpHelp, setShowIpHelp] = useState(false)

  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairState, setRepairState] = useState<RepairState>('idle')
  const [repairMessage, setRepairMessage] = useState('')

  // Per-udid state for the AMFI "Reveal Developer Mode" button. Keyed by
  // udid so two devices in the list can each show their own loading /
  // completed state without cross-contaminating.
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

  // Auto-expand tunnel section when running or the user has saved an IP.
  const tunnelShouldStartOpen = device.tunnelStatus.running || !!localStorage.getItem(STORAGE_KEYS.tunnelIp)

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
    } finally { setDiscovering(false) }
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
    } catch (err: unknown) {
      setTunnelError(err instanceof Error ? err.message : t('device.tunnel_failed'))
    } finally { setTunnelConnecting(false) }
  }, [tunnelIp, tunnelPort, device, showToast, t])

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
    if (repairState !== 'running') setShowRepairConfirm(false)
  }, [repairState])

  return (
    <>
      <Drawer
        data-fc="drawer.device"
        open={open}
        onClose={onClose}
        title={t('device.drawer_settings_title')}
        icon={<Smartphone className="w-4 h-4" />}
        side="left"
        width="w-[min(440px,92vw)]"
      >
        <div className="p-4 flex flex-col gap-3">
          {/* Context header — which device do these settings apply to?
              The device list lives in DevicesPopover; the drawer only
              configures the currently primary device. */}
          {device.connectedDevice ? (() => {
            const d = device.connectedDevice
            const idx = device.devices.findIndex((x) => x.udid === d.udid)
            const isNetwork = d.connection_type === 'Network'
            const idxLetter = idx >= 0 && idx < 26 ? String.fromCharCode(65 + idx) : (d.name?.[0] ?? '•')
            const canRevealDevMode = !!d.can_reveal_developer_mode
            const busy = !!revealInFlight[d.udid]
            return (
              <div className="flex flex-col gap-2">
                <ListRow
                  density="compact"
                  leading={
                    <span
                      className="w-9 h-9 rounded-[10px] grid place-items-center shrink-0 text-white font-semibold text-[14px]"
                      style={{
                        background: `var(${isNetwork ? '--gradient-device-network' : '--gradient-device-usb'})`,
                        boxShadow: 'var(--shadow-avatar-ring)',
                      }}
                      aria-hidden="true"
                    >
                      {idxLetter}
                    </span>
                  }
                  title={<span className="truncate">{d.name}</span>}
                  subtitle={
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      {isNetwork
                        ? <Wifi width={10} height={10} className="text-[var(--color-success-text)]" />
                        : <Usb width={10} height={10} className="text-[var(--color-accent-strong)]" />}
                      <span>{isNetwork ? 'Wi-Fi' : 'USB'}</span>
                      <span className="text-[var(--color-text-3)] opacity-50">·</span>
                      <span>iOS {d.ios_version}</span>
                    </span>
                  }
                  trailing={
                    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] shrink-0 text-[var(--color-success-text)]">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--color-success-text)]"
                        style={{ boxShadow: '0 0 6px var(--color-success-text)' }}
                      />
                      {t('device.chip_state_idle')}
                    </span>
                  }
                />
                {canRevealDevMode && (
                  <button
                    type="button"
                    className="self-end text-[11px] px-2.5 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-2)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-wait transition-colors cursor-pointer"
                    onClick={() => handleRevealDevMode(d.udid)}
                    disabled={busy}
                    title={t('dev_mode.reveal_hint')}
                  >
                    {busy ? t('dev_mode.reveal_working') : t('dev_mode.reveal_button')}
                  </button>
                )}
              </div>
            )
          })() : (
            <EmptyState
              icon={<Smartphone width={ICON_SIZE.lg} height={ICON_SIZE.lg} />}
              title={t('device.no_device')}
              help={t('device.drawer_no_active_hint')}
            />
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
            confirmLabel={t('generic.retry')}
            cancelLabel={t('wifi.repair_cancel')}
            onConfirm={handleRepair}
            onCancel={closeRepairDialog}
          />
        )
      )}
    </>
  )
}
