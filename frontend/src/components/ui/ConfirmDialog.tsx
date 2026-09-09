import React, { useCallback, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useModalDismiss } from '../../hooks/useModalDismiss'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useInitialFocus } from '../../hooks/useInitialFocus'

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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useModalDismiss({ open, onDismiss: onCancel, busy })
  useFocusTrap(dialogRef, open)

  // Danger dialogs focus Cancel so a reflexive Enter can't trigger the
  // destructive action; the default tone keeps Confirm as the target.
  useInitialFocus(open, dialogRef, tone === 'danger' ? cancelRef : confirmRef)

  const handleConfirm = useCallback(() => {
    void onConfirm()
  }, [onConfirm])

  if (!open) return null

  return createPortal(
    <div
      data-fc="modal.confirm"
      className="modal-overlay anim-fade-in"
      onClick={() => { if (!busy) onCancel() }}
      role="presentation"
    >
      <div
        ref={dialogRef}
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
            ref={cancelRef}
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
