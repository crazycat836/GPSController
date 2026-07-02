/**
 * Type guards for narrowing `unknown`-typed WS payloads at the parse
 * boundary. Shared by the sim dispatcher and the device parsers so
 * payload-drift detection (e.g. backend renaming a field) stays visible
 * to TypeScript in both places without duplicating the guards.
 */

export function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v != null ? v as Record<string, unknown> : null
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

export function asStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined
  if (v.every((x): x is string => typeof x === 'string')) return v
  return undefined
}
