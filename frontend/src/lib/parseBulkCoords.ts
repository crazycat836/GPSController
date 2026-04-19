/**
 * Shared bulk coordinate parser for paste-driven UX (bookmark bulk
 * import + route waypoint bulk add).
 *
 * Accepts one coordinate per line. Each line tokenises on any run of
 * ASCII or fullwidth whitespace / commas / semicolons. The first two
 * tokens are lat + lng; any remaining tokens are joined as an optional
 * `name`. Lines that can't be interpreted as a valid lat/lng pair are
 * collected into `errors` with the 1-based line number and reason, so
 * callers can surface them to the user instead of silently dropping.
 *
 * Supported paste shapes:
 *   25.033, 121.565
 *   25.033 121.565 Taipei Main Station
 *   (25.033, 121.565)                    — ASCII parens
 *   （25.033, 121.565）                   — fullwidth parens
 *   @25.033,121.565,15z                  — Google Maps URL tail
 *   25.033；121.565                       — fullwidth semicolon
 */

export interface ParsedCoord {
  lat: number
  lng: number
  name?: string
}

export interface ParseError {
  /** 1-based line number in the original input (blank lines are skipped
   *  but still counted toward this number so users can locate issues). */
  line: number
  /** Original line content after trim, before any preprocessing. */
  raw: string
  /** Short reason code — 'format' | 'range' | 'empty-line' (unused). */
  reason: string
}

export interface ParseResult {
  ok: ParsedCoord[]
  errors: ParseError[]
}

// Bracket characters (ASCII + CJK) we treat as punctuation noise on a
// bulk-paste line. Replaced with whitespace so tokens like
// `（25.0330` and `121.5654）` parse cleanly even when a trailing name
// comes after the closing bracket — a shape that breaks matched-pair
// peeling but users do paste in practice.
const BRACKET_CHARS_RE = /[(（「【〔〈《)）」】〕〉》]/g

function preprocessLine(raw: string): string {
  let t = raw.trim()
  if (!t) return t
  // Normalise fullwidth whitespace + comma / semicolon to ASCII.
  t = t.replace(/\u3000/g, ' ').replace(/\uFF0C/g, ',').replace(/\uFF1B/g, ';')
  // Drop leading '@' from Google Maps share URLs.
  if (t.startsWith('@')) t = t.slice(1).trim()
  // Replace every bracket char with a space. More permissive than
  // matched-pair peeling but handles "(lat,lng) name" correctly.
  t = t.replace(BRACKET_CHARS_RE, ' ')
  // Chop Google Maps zoom suffix like ",15z".
  t = t.replace(/\s*,\s*-?\d+(?:\.\d+)?z\s*(?=,|\s|$)/i, '')
  return t.trim()
}

export function parseBulkCoords(input: string): ParseResult {
  const ok: ParsedCoord[] = []
  const errors: ParseError[] = []

  const rawLines = input.split(/\r?\n/)
  for (let idx = 0; idx < rawLines.length; idx++) {
    const original = rawLines[idx].trim()
    if (!original) continue // skip blank lines silently

    const cleaned = preprocessLine(rawLines[idx])
    if (!cleaned) {
      errors.push({ line: idx + 1, raw: original, reason: 'format' })
      continue
    }

    const tokens = cleaned.split(/[\s,;]+/).filter(Boolean)
    if (tokens.length < 2) {
      errors.push({ line: idx + 1, raw: original, reason: 'format' })
      continue
    }

    const lat = parseFloat(tokens[0])
    const lng = parseFloat(tokens[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push({ line: idx + 1, raw: original, reason: 'format' })
      continue
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      errors.push({ line: idx + 1, raw: original, reason: 'range' })
      continue
    }

    const name = tokens.slice(2).join(' ').trim()
    ok.push(name ? { lat, lng, name } : { lat, lng })
  }

  return { ok, errors }
}
