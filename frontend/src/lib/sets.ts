/**
 * Immutable Set toggle: returns a new Set with `value` added when absent
 * or removed when present. Backs every multi-select / multi-filter chip
 * state in the panels.
 */
export function toggleInSet<T>(prev: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(prev)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
