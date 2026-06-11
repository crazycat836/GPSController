/** Geocoding endpoints (`/api/geocode/*`): forward search + reverse lookup. */
import { STORAGE_KEYS } from '../lib/storage-keys'
import { request } from './http'

export interface AddressSearchResult {
  display_name: string
  lat: number
  lng: number
  type?: string
  importance?: number
}

export interface ReverseGeocodeResult {
  display_name: string
  lat: number
  lng: number
  type: string
  importance: number
  country_code: string  // ISO 3166-1 alpha-2 lowercase, '' if unknown
  country: string       // localized country name
  /** Short human label (POI > road > neighbourhood > …); empty string if
   *  Nominatim has no usable label for the coordinate. */
  place_name?: string
}

/**
 * Forward geocode (search box). The provider is chosen by the user in
 * Settings ('nominatim' | 'photon' | 'google'), defaulting to Photon. When
 * 'google' is selected the saved API key is read from localStorage and sent
 * as a header to the *local* backend only — it never reaches a third party
 * from here. (A missing key makes the backend degrade Google to Photon.)
 */
export const searchAddress = (q: string, lang?: string) => {
  let googleKey = ''
  let provider = ''
  try { googleKey = localStorage.getItem(STORAGE_KEYS.googlePlacesKey)?.trim() || '' } catch { /* ignore */ }
  try { provider = localStorage.getItem(STORAGE_KEYS.searchProvider)?.trim() || '' } catch { /* ignore */ }
  const params = new URLSearchParams({ q })
  if (lang) params.set('lang', lang)
  if (provider) params.set('provider', provider)
  // Only forward the Google key when Google is the active provider, so the
  // backend's legacy "key present == use Google" heuristic doesn't override
  // an explicit Photon / Nominatim choice for users who keep a key saved.
  const headers = provider === 'google' && googleKey ? { 'X-Google-Key': googleKey } : undefined
  return request<AddressSearchResult[]>('GET', `/api/geocode/search?${params.toString()}`, undefined, headers)
}
export const reverseGeocode = (lat: number, lng: number, lang?: string) =>
  request<ReverseGeocodeResult | null>(
    'GET',
    `/api/geocode/reverse?lat=${lat}&lng=${lng}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`,
  )
