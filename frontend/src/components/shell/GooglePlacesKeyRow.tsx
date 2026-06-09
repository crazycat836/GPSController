import { useState, useCallback } from 'react'
import { KeyRound, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { useT } from '../../i18n'
import { STORAGE_KEYS } from '../../lib/storage-keys'
import { openExternalOrDefault } from '../../lib/open-external'

const GET_KEY_URL =
  'https://developers.google.com/maps/documentation/places/web-service/get-api-key'

function readKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.googlePlacesKey) ?? ''
  } catch {
    return ''
  }
}

/**
 * Settings row for the optional user-supplied Google Places API key. When a
 * key is present, the search box routes through Google (see
 * `services/api.ts::searchAddress`); blank falls back to the keyless Photon
 * provider. The key is persisted to localStorage and never leaves the local
 * backend, so masking is a courtesy rather than a security boundary.
 */
export default function GooglePlacesKeyRow() {
  const t = useT()
  const [value, setValue] = useState<string>(readKey)
  const [revealed, setRevealed] = useState(false)

  const persist = useCallback((next: string) => {
    setValue(next)
    try {
      if (next.trim()) {
        localStorage.setItem(STORAGE_KEYS.googlePlacesKey, next.trim())
      } else {
        localStorage.removeItem(STORAGE_KEYS.googlePlacesKey)
      }
    } catch {
      // localStorage unavailable (Electron sandbox edge case) — the field
      // still works for the current session, it just won't persist.
    }
  }, [])

  return (
    <div className="flex flex-col gap-2 px-3 py-[9px]">
      <div className="flex items-center gap-3">
        <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 border text-[var(--color-text-2)] border-[var(--color-border)] bg-white/[0.04]">
          <KeyRound className="w-[14px] h-[14px]" />
        </span>
        <span className="flex-1 text-left text-[13px] text-[var(--color-text-1)] tracking-[-0.005em] truncate">
          {t('settings.google_key')}
        </span>
      </div>

      <div className="flex items-center gap-2 pl-10">
        <div className="flex-1 flex items-center gap-2 px-2.5 h-8 rounded-lg border border-[var(--color-border)] bg-white/[0.03]">
          <input
            type={revealed ? 'text' : 'password'}
            value={value}
            onChange={(e) => persist(e.target.value)}
            placeholder={t('settings.google_key_placeholder')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] font-mono text-[var(--color-text-1)] placeholder:text-[var(--color-text-3)] placeholder:font-sans"
          />
          {value && (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? t('settings.google_key_hide') : t('settings.google_key_show')}
              title={revealed ? t('settings.google_key_hide') : t('settings.google_key_show')}
              className="shrink-0 text-[var(--color-text-3)] hover:text-[var(--color-text-1)] transition-colors cursor-pointer"
            >
              {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      <p className="pl-10 text-[11px] leading-snug text-[var(--color-text-3)]">
        {t('settings.google_key_hint')}{' '}
        <a
          href={GET_KEY_URL}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => openExternalOrDefault(GET_KEY_URL, e)}
          className="inline-flex items-center gap-0.5 text-[var(--color-accent)] hover:underline"
        >
          {t('settings.google_key_get')}
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </p>
    </div>
  )
}
