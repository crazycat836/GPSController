import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Wifi, Usb, Loader2,
  ChevronLeft, Search, PlugZap,
} from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useT } from '../../i18n'
import { wifiTunnelDiscover } from '../../services/api'
import { ICON_SIZE } from '../../lib/icons'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import { DEFAULT_TUNNEL_PORT } from '../../lib/constants'
import DeviceListView from './DeviceListView'
import DeviceManageView from './DeviceManageView'

interface DevicesPopoverProps {
  // Null hides the popover. A DOMRect positions it beneath the trigger
  // (the top-bar Devices icon button).
  anchor: DOMRect | null
  onClose: () => void
}

type DevView = 'list' | 'manage' | 'add'

const POPOVER_WIDTH = 360
const POPOVER_GAP = 8

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
  // Depend on the boolean (open vs. closed), NOT on the DOMRect itself —
  // the parent passes a fresh getBoundingClientRect() on every open and
  // on viewport resize. Using `anchor` as the dep would wipe in-progress
  // sub-view interactions (Manage / Add) on an unrelated re-anchor.
  useEffect(() => { if (anchor) setView('list') }, [!!anchor])

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

  // Manage view raises this when its Forget / Repair confirm dialogs are
  // open, so the orchestrator can suppress its outside-click + ESC handler
  // (otherwise the dialog overlay would close the popover too).
  const [manageModalOpen, setManageModalOpen] = useState(false)

  // ─── Outside-click + ESC handling ────────────────────────────
  useEffect(() => {
    if (!anchor) return
    const onDown = (e: Event) => {
      const target = e.target as Element | null
      if (target && panelRef.current?.contains(target)) return
      // Don't close if a modal child dialog has focus.
      if (manageModalOpen) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Modal dialogs handle their own ESC.
      if (manageModalOpen) return
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
  }, [anchor, onClose, view, manageModalOpen])

  if (!anchor) return null

  // ─── Layout positioning ──────────────────────────────────────
  const viewportW = window.innerWidth
  const right = Math.max(8, viewportW - anchor.right)
  const top = anchor.bottom + POPOVER_GAP
  const left = Math.max(8, viewportW - right - POPOVER_WIDTH)

  const selectedUdid = device.connectedDevice?.udid

  // Manage and Add views share the same back-arrow + title shell;
  // list view uses a different header shape (count + scan + manage).
  function renderViewHeader(title: string) {
    return (
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
          {title}
        </span>
      </div>
    )
  }


  function renderAddView() {
    return (
      <>
        {renderViewHeader(t('device.popover_add_title'))}

        <div className="px-3.5 pt-3.5 pb-3 flex flex-col gap-4 max-h-[420px] overflow-y-auto scrollbar-thin">
          {/* USB section — guidance only; the actual scan button lives
              in the list view header, where the result (refreshed list)
              is visible. No need to duplicate the action here. */}
          <section className="flex flex-col gap-2">
            <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-1)]">
              <Usb width={14} height={14} />
              {t('device.add_via_usb')}
            </div>
            <p className="text-[11px] text-[var(--color-text-3)] leading-[1.5]">
              {t('device.add_via_usb_hint')}
            </p>
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
        style={{ width: POPOVER_WIDTH, left, top, transformOrigin: 'top right' }}
      >
        {view === 'list' && (
          <DeviceListView
            onClose={onClose}
            onManage={() => setView('manage')}
            onAdd={() => setView('add')}
          />
        )}
        {view === 'manage' && (
          <>
            {renderViewHeader(t('device.popover_manage_title'))}
            <DeviceManageView onModalOpenChange={setManageModalOpen} />
          </>
        )}
        {view === 'add' && renderAddView()}

      </div>
    </>,
    document.body,
  )
}
