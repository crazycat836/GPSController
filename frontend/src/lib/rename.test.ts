import { describe, it, expect, vi } from 'vitest'
import { commitTrimmedRename } from './rename'

describe('commitTrimmedRename', () => {
  it('calls rename with the trimmed draft when it differs from the current name', () => {
    // Arrange
    const rename = vi.fn()

    // Act
    commitTrimmedRename('  New Name  ', 'Old Name', rename)

    // Assert
    expect(rename).toHaveBeenCalledExactlyOnceWith('New Name')
  })

  it('skips commit when the trimmed draft is empty', () => {
    const rename = vi.fn()

    commitTrimmedRename('   ', 'Old Name', rename)

    expect(rename).not.toHaveBeenCalled()
  })

  it('skips commit when the trimmed draft equals the current name', () => {
    const rename = vi.fn()

    commitTrimmedRename(' Old Name ', 'Old Name', rename)

    expect(rename).not.toHaveBeenCalled()
  })

  it('skips commit when the rename target is unknown (currentName undefined)', () => {
    const rename = vi.fn()

    commitTrimmedRename('New Name', undefined, rename)

    expect(rename).not.toHaveBeenCalled()
  })
})
