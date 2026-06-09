import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Search, MapPin } from 'lucide-react'
import { searchAddress } from '../../services/api'
import { useT, useI18n, type Lang } from '../../i18n'
import { useOutsideClick } from '../../hooks/useOutsideClick'

// Mirror the reverse-geocode hook's language chain so result names come back
// in the UI language. Traditional-Chinese lists `zh-Hant`/`zh-TW` ahead of
// bare `zh` so providers don't fall back to Simplified labels. Typed against
// the `Lang` union (not bare `string`) so a non-locale value can't slip in.
function searchLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-Hant,zh-TW,zh,en' : 'en'
}

const COORD_RE = /^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)$/

interface SearchResult {
  name: string
  lat: number
  lng: number
  address?: string
}

interface SearchBarProps {
  onTeleport: (lat: number, lng: number) => void
  deviceConnected: boolean
}

export default function SearchBar({ onTeleport, deviceConnected }: SearchBarProps) {
  const t = useT()
  const { lang } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  // Distinct from "no results": true only when searchAddress actually
  // rejects (transport / backend-app failure). The geocoder-unavailable
  // case resolves to [] per the backend contract, so an empty array is NOT
  // an error — collapsing the two would report outages as "no results".
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parse coordinate from input
  const coordMatch = COORD_RE.exec(query.trim())
  const parsedCoord = coordMatch ? {
    lat: parseFloat(coordMatch[1]),
    lng: parseFloat(coordMatch[2]),
  } : null
  const validCoord = parsedCoord &&
    parsedCoord.lat >= -90 && parsedCoord.lat <= 90 &&
    parsedCoord.lng >= -180 && parsedCoord.lng <= 180
    ? parsedCoord : null

  // Address search with debounce
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2 || COORD_RE.test(q.trim())) {
      setResults([])
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    try {
      const raw = await searchAddress(q, searchLang(lang))
      setResults((Array.isArray(raw) ? raw : []).map((r) => ({
        name: r.display_name,
        lat: r.lat,
        lng: r.lng,
      })))
      setOpen(true)
    } catch {
      // Real failure (transport / backend down / malformed envelope) — show
      // an error rather than the misleading "no results" empty state.
      setResults([])
      setError(true)
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }, [lang])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(e.target.value), 300)
  }, [doSearch])

  const handleSelect = useCallback((lat: number, lng: number) => {
    onTeleport(lat, lng)
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
  }, [onTeleport])

  const handleSubmit = useCallback(() => {
    if (validCoord) {
      handleSelect(validCoord.lat, validCoord.lng)
    }
  }, [validCoord, handleSelect])

  // ⌘K to focus the search input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Close dropdown on outside click. Standardised on `pointerdown` via the
  // shared hook so dismissal also fires for touch and pen input.
  const closeDropdown = useCallback(() => setOpen(false), [])
  useOutsideClick(containerRef, closeDropdown, open)

  // Cleanup debounce
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const showDropdown = open || (focused && (validCoord != null || loading || error))

  return (
    <div ref={containerRef} data-fc="topbar.search" className="relative">
      {/* Input */}
      <div className="glass-pill flex items-center gap-2.5 px-4 h-11 w-[380px]">
        <Search className="w-[14px] h-[14px] text-[var(--color-text-3)] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => { setFocused(true); if (results.length > 0) setOpen(true) }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSubmit()
            if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
          }}
          placeholder={t('search.unified_placeholder')}
          className="flex-1 bg-transparent border-none outline-none text-[var(--color-text-1)] text-[13px] placeholder:text-[var(--color-text-3)]"
        />
        {!focused && (
          <kbd className="text-[10px] font-mono text-[var(--color-text-3)] bg-white/[0.05] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
            ⌘K
          </kbd>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div
          className="absolute top-full left-0 mt-2 w-full surface-popup rounded-xl overflow-hidden anim-fade-slide-up"
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Coordinate match */}
          {validCoord && (
            <button
              onClick={() => handleSelect(validCoord.lat, validCoord.lng)}
              disabled={!deviceConnected}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              <MapPin className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-[var(--color-text-1)]">
                  {t('search.coord_detected')}
                </div>
                <div className="text-[12px] font-mono text-[var(--color-text-3)]">
                  {validCoord.lat.toFixed(6)}, {validCoord.lng.toFixed(6)}
                </div>
              </div>
            </button>
          )}

          {/* Loading */}
          {loading && (
            <div className="px-4 py-3 text-[13px] text-[var(--color-text-3)]">
              {t('search.searching')}
            </div>
          )}

          {/* Address results */}
          {results.map((r) => (
            <button
              key={`${r.lat.toFixed(6)}_${r.lng.toFixed(6)}_${r.name}`}
              onClick={() => handleSelect(r.lat, r.lng)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
            >
              <MapPin className="w-4 h-4 text-[var(--color-text-3)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-[var(--color-text-1)] truncate">
                  {r.name}
                </div>
                {r.address && (
                  <div className="text-[12px] text-[var(--color-text-3)] truncate">
                    {r.address}
                  </div>
                )}
              </div>
            </button>
          ))}

          {/* Search failed — transport / backend error, distinct from empty results */}
          {!loading && error && (
            <div className="px-4 py-3 text-[13px] text-[var(--color-text-3)] text-center">
              {t('search.error')}
            </div>
          )}

          {/* No results */}
          {!loading && !error && results.length === 0 && !validCoord && query.trim().length >= 2 && (
            <div className="px-4 py-3 text-[13px] text-[var(--color-text-3)] text-center">
              {t('search.no_results')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
