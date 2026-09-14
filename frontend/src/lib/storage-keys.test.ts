// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEYS, migrateLegacyKeys } from './storage-keys'

describe('migrateLegacyKeys', () => {
  beforeEach(() => localStorage.clear())

  it('moves every gpscontroller.* key to geomirage.*', () => {
    localStorage.setItem('gpscontroller.lang', 'en')
    localStorage.setItem('gpscontroller.tunnel.port', '51234')
    localStorage.setItem('unrelated', 'x')

    migrateLegacyKeys()

    expect(localStorage.getItem(STORAGE_KEYS.lang)).toBe('en')
    expect(localStorage.getItem(STORAGE_KEYS.tunnelPort)).toBe('51234')
    expect(localStorage.getItem('gpscontroller.lang')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('x')
  })

  it('keeps a value already saved under the new key', () => {
    localStorage.setItem('gpscontroller.lang', 'en')
    localStorage.setItem(STORAGE_KEYS.lang, 'zh')

    migrateLegacyKeys()

    expect(localStorage.getItem(STORAGE_KEYS.lang)).toBe('zh')
    expect(localStorage.getItem('gpscontroller.lang')).toBeNull()
  })

  it('moves the old camelCase avatar keys straight to the current names', () => {
    localStorage.setItem('gpsController.avatarSelection', 'fox')

    migrateLegacyKeys()

    expect(localStorage.getItem(STORAGE_KEYS.avatarSelection)).toBe('fox')
    expect(localStorage.getItem('gpsController.avatarSelection')).toBeNull()
  })
})
