// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import InlineRenameInput from './InlineRenameInput'

afterEach(cleanup)

function setup() {
  const onChange = vi.fn()
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <InlineRenameInput value="draft" onChange={onChange} onCommit={onCommit} onCancel={onCancel} />,
  )
  const input = utils.container.querySelector('input')!
  return { input, onChange, onCommit, onCancel }
}

describe('InlineRenameInput', () => {
  it('commits on Enter', () => {
    const { input, onCommit } = setup()

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledOnce()
  })

  it('does NOT commit on Enter while IME composition is in progress', () => {
    const { input, onCommit, onCancel } = setup()

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const { input, onCommit, onCancel } = setup()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits on blur', () => {
    const { input, onCommit } = setup()

    fireEvent.blur(input)

    expect(onCommit).toHaveBeenCalledOnce()
  })

  it('forwards typed text through onChange', () => {
    const { input, onChange } = setup()

    fireEvent.change(input, { target: { value: 'renamed' } })

    expect(onChange).toHaveBeenCalledExactlyOnceWith('renamed')
  })
})
