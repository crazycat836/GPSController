import { useCallback, useState } from 'react'

export interface PcCoord {
  lat: number
  lng: number
  accuracy: number
  timestamp: number
}

export type PcLocationErrorCode =
  | 'insecure'
  | 'permission_denied'
  | 'unavailable'
  | 'timeout'
  | 'unsupported'

export interface PcLocationError {
  code: PcLocationErrorCode
  message: string
}

interface UsePcLocationReturn {
  coord: PcCoord | null
  loading: boolean
  error: PcLocationError | null
  request: () => Promise<PcCoord | null>
  clear: () => void
}

// Session-scope cache so reopening the popover reuses the last fix until
// the user explicitly hits "Refresh". Module-level on purpose — outlives
// hook unmounts (e.g. if the trigger button unmounts when the header
// rerenders) but resets on page reload, which matches "PC location for
// this session" semantics.
let cachedCoord: PcCoord | null = null
let inFlight: Promise<PcCoord | null> | null = null

const TIMEOUT_MS = 10_000
const MAX_AGE_MS = 60_000

function isSecureEnough(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function mapGeolocationError(err: GeolocationPositionError): PcLocationError {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return { code: 'permission_denied', message: err.message || 'Permission denied' }
    case err.POSITION_UNAVAILABLE:
      return { code: 'unavailable', message: err.message || 'Position unavailable' }
    case err.TIMEOUT:
      return { code: 'timeout', message: err.message || 'Timeout' }
    default:
      return { code: 'unavailable', message: err.message || 'Unknown geolocation error' }
  }
}

export function usePcLocation(): UsePcLocationReturn {
  const [coord, setCoord] = useState<PcCoord | null>(cachedCoord)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<PcLocationError | null>(null)

  const request = useCallback(async (): Promise<PcCoord | null> => {
    if (inFlight) return inFlight

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const e: PcLocationError = { code: 'unsupported', message: 'navigator.geolocation unavailable' }
      setError(e)
      return null
    }
    if (!isSecureEnough()) {
      const e: PcLocationError = { code: 'insecure', message: 'Requires HTTPS or localhost' }
      setError(e)
      return null
    }

    setLoading(true)
    setError(null)

    const promise = new Promise<PcCoord | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next: PcCoord = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp || Date.now(),
          }
          cachedCoord = next
          setCoord(next)
          setLoading(false)
          resolve(next)
        },
        (err) => {
          setError(mapGeolocationError(err))
          setLoading(false)
          resolve(null)
        },
        {
          enableHighAccuracy: true,
          timeout: TIMEOUT_MS,
          maximumAge: MAX_AGE_MS,
        },
      )
    })

    inFlight = promise
    try {
      return await promise
    } finally {
      inFlight = null
    }
  }, [])

  const clear = useCallback(() => {
    cachedCoord = null
    setCoord(null)
    setError(null)
  }, [])

  return { coord, loading, error, request, clear }
}
