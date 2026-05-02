import { useCallback, useEffect, useState } from 'react'
import { Loader2, Power, RotateCcw, Shield, Trash2 } from 'lucide-react'
import { useDeviceContext } from '../../contexts/DeviceContext'
import { useToastContext } from '../../contexts/ToastContext'
import { useT } from '../../i18n'
import { revealDeveloperMode, wifiRepair } from '../../services/api'
import { ICON_SIZE } from '../../lib/icons'
import ConfirmDialog from '../ui/ConfirmDialog'
import { DeviceAvatar, DeviceInfoColumn, getDeviceMeta } from './deviceRowParts'

type RowAction = 'reveal' | 'disconnect'
type RepairState = 'idle' | 'running' | 'success' | 'failed'

export interface DeviceManageViewProps {
  // Notify the orchestrator when a modal child dialog (forget / repair) is
  // open, so it can suppress its outside-click-to-close handler. Without
  // this, clicking "Cancel" on the dialog would propagate and close the
  // popover too.
  onModalOpenChange: (open: boolean) => void
}

export default function DeviceManageView({ onModalOpenChange }: DeviceManageViewProps) {
  const t = useT()
  const device = useDeviceContext()
  const { showToast } = useToastContext()

  // Per-row actions (Reveal Dev Mode / Disconnect) are exclusive in
  // practice — only one row's button is clickable at a time — so a
  // single { udid, action } slot replaces two parallel maps.
  const [inFlight, setInFlight] = useState<{ udid: string; action: RowAction } | null>(null)

  const [forgetUdid, setForgetUdid] = useState<string | null>(null)
  const [forgetting, setForgetting] = useState(false)

  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairState, setRepairState] = useState<RepairState>('idle')
  const [repairMessage, setRepairMessage] = useState('')

  // Keep the orchestrator informed about whether either confirm dialog is
  // visible so it can pause its outside-click and ESC handlers.
  useEffect(() => {
    onModalOpenChange(!!forgetUdid || showRepairConfirm)
  }, [forgetUdid, showRepairConfirm, onModalOpenChange])

  const handleRevealDevMode = useCallback(async (udid: string) => {
    setInFlight({ udid, action: 'reveal' })
    try {
      await revealDeveloperMode(udid)
      showToast(t('dev_mode.reveal_success'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`${t('dev_mode.reveal_failed')}: ${msg}`)
    } finally {
      setInFlight(null)
    }
  }, [showToast, t])

  const handleDisconnect = useCallback(async (udid: string) => {
    setInFlight({ udid, action: 'disconnect' })
    try {
      await device.disconnect(udid)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(msg)
    } finally {
      setInFlight(null)
    }
  }, [device, showToast])

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

  const repairCopy = (() => {
    switch (repairState) {
      case 'running':
        return { description: t('wifi.repair_running'), confirmLabel: t('wifi.repair_running') }
      case 'success':
        return {
          description: `${t('wifi.repair_success')}${repairMessage ? ` — ${repairMessage}` : ''}`,
          confirmLabel: t('generic.confirm'),
        }
      case 'failed':
        return {
          description: `${t('wifi.repair_failed')}${repairMessage ? `: ${repairMessage}` : ''}`,
          confirmLabel: t('generic.confirm'),
        }
      default:
        return { description: t('wifi.repair_confirm_body'), confirmLabel: t('wifi.repair_button') }
    }
  })()

  const selectedUdid = device.connectedDevice?.udid

  return (
    <>
      <div className="p-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
        {device.devices.length === 0 ? (
          <div className="py-10 px-4 text-center text-[12px] text-[var(--color-text-3)]">
            {t('device.no_device')}
          </div>
        ) : (
          device.devices.map((d, idx) => {
            const meta = getDeviceMeta(d, idx, selectedUdid)
            const { unsupported } = meta
            const canRevealDevMode = !!d.can_reveal_developer_mode
            const revealing = inFlight?.udid === d.udid && inFlight.action === 'reveal'
            const disconnecting = inFlight?.udid === d.udid && inFlight.action === 'disconnect'
            const isOnline = d.is_connected
            return (
              <div
                key={d.udid}
                className="grid items-center gap-2 w-full px-2 py-2 rounded-[10px]"
                style={{ gridTemplateColumns: '36px 1fr auto' }}
              >
                <DeviceAvatar meta={meta} />
                <DeviceInfoColumn device={d} meta={meta} />
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
        description={repairCopy.description}
        confirmLabel={repairCopy.confirmLabel}
        cancelLabel={t('generic.cancel')}
        tone="default"
        busy={repairState === 'running'}
        onConfirm={() => {
          if (repairState === 'idle') void handleRepair()
          else closeRepairDialog()
        }}
        onCancel={closeRepairDialog}
      />
    </>
  )
}
