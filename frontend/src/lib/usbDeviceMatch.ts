/**
 * Best-effort matching between a Wi-Fi-discovered device (mDNS instance name
 * or reverse-DNS hostname) and a USB-connected device's name from usbmux.
 *
 * iOS derives the mDNS hostname from the device name by transliterating and
 * replacing separators (e.g. "Gary's iPhone" → "Garys-iPhone.local"), so a
 * strict string compare never matches. Normalizing both sides to a bare
 * lowercase alphanumeric form (CJK kept for Chinese device names) makes the
 * common cases comparable while staying conservative — an empty normalized
 * form never matches.
 *
 * The RemotePairing mDNS *instance* name is often an opaque hex identifier
 * (pairing ID / MAC-derived) rather than the device name, so display-name
 * selection prefers the human-readable candidate: broadcast name → hostname
 * (minus `.local`) → IP.
 */

const LOCAL_SUFFIX_RE = /\.local\.?$/i
// Minimum length at which an all-hex string is assumed to be an identifier
// rather than a short human name like "Ed" or "Abe".
const OPAQUE_HEX_MIN_LENGTH = 6

export interface DiscoveredDeviceLike {
  name: string
  host?: string
}

export interface DiscoveredDeviceDisplay extends DiscoveredDeviceLike {
  ip: string
}

export function normalizeDeviceName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(LOCAL_SUFFIX_RE, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9぀-ヿ一-鿿가-힣]+/g, '')
}

/** Returns the (original, un-normalized) USB device name the discovered
 * entry corresponds to, or null when no USB device matches. */
export function findUsbDeviceName(
  discovered: DiscoveredDeviceLike,
  usbDeviceNames: readonly string[],
): string | null {
  const candidates = [discovered.name, discovered.host ?? '']
    .map(normalizeDeviceName)
    .filter((c) => c.length > 0)
  if (candidates.length === 0) return null

  return (
    usbDeviceNames.find((usbName) => {
      const normalized = normalizeDeviceName(usbName)
      return normalized.length > 0 && candidates.includes(normalized)
    }) ?? null
  )
}

export function matchesUsbDevice(
  discovered: DiscoveredDeviceLike,
  usbDeviceNames: readonly string[],
): boolean {
  return findUsbDeviceName(discovered, usbDeviceNames) !== null
}

/** True when the string reads as a device name a human chose, as opposed to
 * an IP echo or an opaque hex identifier (pairing ID, MAC, UDID prefix). */
function isHumanReadableName(candidate: string, ip: string): boolean {
  if (!candidate || candidate === ip) return false
  const alphanumeric = candidate.replace(/[:\-.\s]/g, '')
  if (alphanumeric.length === 0) return false
  const isAllHex = /^[0-9a-f]+$/i.test(alphanumeric)
  return !(isAllHex && alphanumeric.length >= OPAQUE_HEX_MIN_LENGTH)
}

/** Pick the most human-readable label for a discovered device:
 * broadcast name → hostname without `.local` → raw name → IP. */
export function discoveredDisplayName(discovered: DiscoveredDeviceDisplay): string {
  const host = (discovered.host ?? '').replace(LOCAL_SUFFIX_RE, '')
  if (isHumanReadableName(discovered.name, discovered.ip)) return discovered.name
  if (isHumanReadableName(host, discovered.ip)) return host
  return discovered.name || host || discovered.ip
}
