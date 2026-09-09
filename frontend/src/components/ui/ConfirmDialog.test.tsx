// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, act } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderDialog(tone: 'default' | 'danger') {
  render(
    <ConfirmDialog
      open
      title="Delete bookmark?"
      confirmLabel="Delete"
      cancelLabel="Cancel"
      tone={tone}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
}

describe('ConfirmDialog initial focus', () => {
  it('focuses the confirm button for the default tone', () => {
    renderDialog('default')

    act(() => {
      vi.advanceTimersByTime(60)
    })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }))
  })

  it('focuses the cancel button for the danger tone so Enter cannot confirm destructively', () => {
    renderDialog('danger')

    act(() => {
      vi.advanceTimersByTime(60)
    })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })
})
