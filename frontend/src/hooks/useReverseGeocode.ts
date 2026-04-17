import { useEffect, useState } from 'react'
import { reverseGeocode } from '../services/api'

interface CountryInfo {
  countryCode: string  // ISO 3166-1 alpha-2 lowercase, '' until first hit
  country: string      // localized country name
}

const EMPTY: CountryInfo = { countryCode: '', country: '' }
const DEBOUNCE_MS = 600

// Map UI lang to Nominatim Accept-Language. Listing zh first prefers
// Traditional/Simplified country names, with English as a sane fallback.
function nominatimLang(lang: string): string {
  return lang === 'zh' ? 'zh,en' : 'en'
}

export function useReverseGeocode(
  pos: { lat: number; lng: number } | null,
  lang: string,
): CountryInfo {
  const [info, setInfo] = useState<CountryInfo>(EMPTY)

  useEffect(() => {
    if (!pos) return
    let cancelled = false
    const tid = setTimeout(async () => {
      try {
        const res = await reverseGeocode(pos.lat, pos.lng, nominatimLang(lang))
        if (cancelled || !res) return
        const cc = (res.country_code || '').toLowerCase()
        const name = res.country || ''
        setInfo((prev) =>
          prev.countryCode === cc && prev.country === name ? prev : { countryCode: cc, country: name },
        )
      } catch {
        // offline / rate-limited — keep previous value
      }
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(tid)
    }
  }, [pos?.lat, pos?.lng, lang])

  return info
}
