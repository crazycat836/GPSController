import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft } from 'lucide-react'
import { useT } from '../../i18n'
import DeviceListView from './DeviceListView'
import DeviceManageView from './DeviceManageView'
import DeviceAddView from './DeviceAddView'

interface DevicesPopoverProps {
  // Null hides the popover. A DOMRect positions it beneath the trigger
  // (the top-bar Devices icon button).
  anchor: DOMRect | null
  onClose: () => void
}

type DevView = 'list' | 'manage' | 'add'

const POPOVER_WIDTH = 360
const POPOVER_GAP = 8
const VIEWPORT_EDGE_PADDING = 8

// All device flows live inside this single popover (per the redesign):
// - list   — paired devices + scan + Add-device entry
// - manage — disconnect / forget / reveal-dev-mode per row, repair pairing footer
// - add    — USB scan + Wi-Fi Tunnel form (multi-result auto-detect picker)
//
// This component is the orchestrator only: it owns the active view, the
// popover frame + positioning, the ESC / outside-click dismissal, and the
// shared back-arrow header rendered above manage/add. Each subview is its
// own per-file component and reads device/toast contexts directly.
export default function DevicesPopover({ anchor, onClose }: DevicesPopoverProps) {
  const t = useT()
  const panelRef = useRef<HTMLDivElement>(null)

  const [view, setView] = useState<DevView>('list')
  // Reset to the list view whenever the popover is re-opened, so it
  // doesn't reappear stuck on a previous nested view.
  // Depend on the boolean (open vs. closed), NOT on the DOMRect itself —
  // the parent passes a fresh getBoundingClientRect() on every open and
  // on viewport resize. Using `anchor` as the dep would wipe in-progress
  // sub-view interactions (Manage / Add) on an unrelated re-anchor.
  useEffect(() => { if (anchor) setView('list') }, [!!anchor])

  // Manage view raises this when its Forget / Repair confirm dialogs are
  // open, so the orchestrator can suppress its outside-click + ESC handler
  // (otherwise the dialog overlay would close the popover too).
  const [manageModalOpen, setManageModalOpen] = useState(false)

  useEffect(() => {
    if (!anchor) return
    const onDown = (e: Event) => {
      const target = e.target as Element | null
      if (target && panelRef.current?.contains(target)) return
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

  const viewportW = window.innerWidth
  const right = Math.max(VIEWPORT_EDGE_PADDING, viewportW - anchor.right)
  const top = anchor.bottom + POPOVER_GAP
  const left = Math.max(VIEWPORT_EDGE_PADDING, viewportW - right - POPOVER_WIDTH)

  // Manage and Add share the same back-arrow + title shell; list uses a
  // different header shape (count + scan + manage) which it owns itself.
  const subviewHeader = (title: string) => (
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

  return createPortal(
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
          {subviewHeader(t('device.popover_manage_title'))}
          <DeviceManageView onModalOpenChange={setManageModalOpen} />
        </>
      )}
      {view === 'add' && (
        <>
          {subviewHeader(t('device.popover_add_title'))}
          <DeviceAddView onConnected={() => setView('list')} />
        </>
      )}
    </div>,
    document.body,
  )
}
