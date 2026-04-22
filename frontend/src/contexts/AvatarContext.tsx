import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { AVATAR_PRESETS, DEFAULT_AVATAR_KEY, type AvatarPresetKey } from '../lib/avatars'
import { STORAGE_KEYS } from '../lib/storage-keys'

export type AvatarKind = { kind: 'preset'; key: AvatarPresetKey } | { kind: 'custom' }

interface AvatarContextValue {
  /** Currently applied avatar (preset or custom). */
  current: AvatarKind
  /** Base64 data URL for the custom PNG, or '' if none uploaded yet. */
  customDataUrl: string
  applyPreset: (key: AvatarPresetKey) => void
  applyCustom: () => boolean
  /** Store a freshly uploaded PNG. Does NOT auto-apply — caller decides. */
  uploadCustom: (file: File) => Promise<void>
  clearCustom: () => void
}

const AvatarContext = createContext<AvatarContextValue | null>(null)

const LS_KEY_SELECTION = STORAGE_KEYS.avatarSelection
const LS_KEY_CUSTOM = STORAGE_KEYS.avatarCustom
const CUSTOM_MAX_BYTES = 512 * 1024 // guard against storing multi-MB PNGs

function loadSelection(): AvatarKind {
  try {
    const raw = localStorage.getItem(LS_KEY_SELECTION)
    if (!raw) return { kind: 'preset', key: DEFAULT_AVATAR_KEY }
    const parsed = JSON.parse(raw) as AvatarKind
    if (parsed.kind === 'custom') return parsed
    if (parsed.kind === 'preset' && AVATAR_PRESETS.some((p) => p.key === parsed.key)) return parsed
  } catch {
    // Fall through to default
  }
  return { kind: 'preset', key: DEFAULT_AVATAR_KEY }
}

function loadCustom(): string {
  try {
    return localStorage.getItem(LS_KEY_CUSTOM) ?? ''
  } catch {
    return ''
  }
}

export function AvatarProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<AvatarKind>(() => loadSelection())
  const [customDataUrl, setCustomDataUrl] = useState<string>(() => loadCustom())

  // If a previously-selected 'custom' avatar has no data backing it (e.g.
  // user cleared localStorage mid-session), fall back to the default preset
  // so the marker never tries to render an empty src.
  useEffect(() => {
    if (current.kind === 'custom' && !customDataUrl) {
      setCurrent({ kind: 'preset', key: DEFAULT_AVATAR_KEY })
    }
  }, [current.kind, customDataUrl])

  const persist = useCallback((next: AvatarKind) => {
    try {
      localStorage.setItem(LS_KEY_SELECTION, JSON.stringify(next))
    } catch {
      // Storage may be full / disabled — the in-memory state still works.
    }
  }, [])

  const applyPreset = useCallback((key: AvatarPresetKey) => {
    const next: AvatarKind = { kind: 'preset', key }
    setCurrent(next)
    persist(next)
  }, [persist])

  const applyCustom = useCallback((): boolean => {
    // Only switch if we actually have data. Return value lets the UI surface
    // a toast when the user clicks "Apply" with nothing uploaded.
    if (!customDataUrl) return false
    const next: AvatarKind = { kind: 'custom' }
    setCurrent(next)
    persist(next)
    return true
  }, [customDataUrl, persist])

  const uploadCustom = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      throw new Error('not-an-image')
    }
    if (file.size > CUSTOM_MAX_BYTES) {
      throw new Error('too-large')
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('read-failed'))
      reader.readAsDataURL(file)
    })
    setCustomDataUrl(dataUrl)
    try {
      localStorage.setItem(LS_KEY_CUSTOM, dataUrl)
    } catch {
      // Persisted in-memory only. Reloading the page will drop the upload.
    }
  }, [])

  const clearCustom = useCallback(() => {
    setCustomDataUrl('')
    try {
      localStorage.removeItem(LS_KEY_CUSTOM)
    } catch {
      // ignore
    }
    if (current.kind === 'custom') {
      const next: AvatarKind = { kind: 'preset', key: DEFAULT_AVATAR_KEY }
      setCurrent(next)
      persist(next)
    }
  }, [current.kind, persist])

  const value: AvatarContextValue = {
    current,
    customDataUrl,
    applyPreset,
    applyCustom,
    uploadCustom,
    clearCustom,
  }

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>
}

export function useAvatarContext(): AvatarContextValue {
  const ctx = useContext(AvatarContext)
  if (!ctx) throw new Error('useAvatarContext must be used within AvatarProvider')
  return ctx
}
