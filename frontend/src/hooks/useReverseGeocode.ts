import { useEffect, useState } from 'react'
import { reverseGeocode } from '../services/api'

interface CountryInfo {
  countryCode: string  // ISO 3166-1 alpha-2 lowercase, '' until first hit
  country: string      // localized country name
}

interface ReverseGeocodeOptions {
  /** When true, suppresses API calls and preserves the last-known value.
   *  Typical use: gate on active simulation so Navigate/RandomWalk doesn't
   *  flood the USB channel with debounced geocode requests every 600ms. */
  paused?: boolean
}

const EMPTY: CountryInfo = { countryCode: '', country: '' }
const DEBOUNCE_MS = 600

// Map UI lang to Nominatim Accept-Language. For Traditional-Chinese UI we
// must list `zh-Hant` (and `zh-TW`) ahead of the bare `zh`: OSM's `name:zh`
// tag for many countries is a semicolon-joined "法国;法國", so matching it
// directly leaks the simplified form into the status bar. `zh-Hant` maps
// cleanly to `name:zh-Hant` (法國), falling back to `zh` / `en` only when
// the Hant tag is absent.
function nominatimLang(lang: string): string {
  return lang === 'zh' ? 'zh-Hant,zh-TW,zh,en' : 'en'
}

export function useReverseGeocode(
  pos: { lat: number; lng: number } | null,
  lang: string,
  options: ReverseGeocodeOptions = {},
): CountryInfo {
  const { paused = false } = options
  const [info, setInfo] = useState<CountryInfo>(EMPTY)

  useEffect(() => {
    if (!pos) return
    // Hold the last-known flag/country while moving. The flag doesn't need
    // per-tick refresh during travel — we only re-query once the user stops.
    const hasValue = !!info.countryCode
    if (paused && hasValue) return

    let cancelled = false
    const doFetch = async () => {
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
    }

    // First resolution (no cached value yet) fires immediately. During an
    // active sim the position ticks every ~600ms, so the debounce below
    // would otherwise be reset every tick and the status pair's location
    // chip would stay empty forever.
    if (!hasValue) {
      doFetch()
      return () => {
        cancelled = true
      }
    }

    const tid = setTimeout(doFetch, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(tid)
    }
  }, [pos?.lat, pos?.lng, lang, paused, info.countryCode])

  return info
}
