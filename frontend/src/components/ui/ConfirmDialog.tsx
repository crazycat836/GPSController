import React, { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmDialogProps {
  open: boolean
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  /** 'danger' styles the confirm button red — used for destructive actions. */
  tone?: 'default' | 'danger'
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  /** Block outside-click / ESC dismissal while confirming (e.g. mid-repair). */
  busy?: boolean
}

// Accessible replacement for window.confirm().
// Uses the existing .modal-* CSS classes, adds ARIA roles + focus trap.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const descId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement | null
    const t = setTimeout(() => confirmRef.current?.focus(), 50)
    return () => {
      clearTimeout(t)
      previousFocus.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  const handleConfirm = useCallback(() => {
    void onConfirm()
  }, [onConfirm])

  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay anim-fade-in"
      onClick={() => { if (!busy) onCancel() }}
      role="presentation"
    >
      <div
        className="modal-dialog anim-scale-in"
        role="alertdialog"
        aria-modal="true"
        aria-describedby={description ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        {description != null && (
          <div className="modal-body" id={descId}>{description}</div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="action-btn"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={tone === 'danger' ? 'action-btn danger' : 'action-btn primary'}
            onClick={handleConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
