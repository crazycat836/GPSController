// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, act } from '@testing-library/react'
import Modal from './Modal'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Modal initial focus', () => {
  it('moves focus to the first focusable element on open', () => {
    render(
      <Modal open onClose={vi.fn()} title="Title" actions={<button type="button">OK</button>}>
        body
      </Modal>,
    )

    act(() => {
      vi.advanceTimersByTime(60)
    })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'OK' }))
  })

  it('falls back to the dialog container when nothing inside is focusable', () => {
    render(
      <Modal open onClose={vi.fn()} title="Title">
        body
      </Modal>,
    )

    act(() => {
      vi.advanceTimersByTime(60)
    })

    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })
})
