// Shared bookmark / place helpers.
//
// The "Default" place was historically created with one of three names
// depending on which locale seeded it (legacy installs persisted the
// translated literal rather than a stable id). Code that needs to
// special-case it should use `isDefaultPlace` rather than re-asserting
// the literal-string list everywhere — keeps the leak in one place and
// makes it greppable when we eventually unify on an id.

const DEFAULT_PLACE_NAMES = new Set<string>(['預設', 'Default', 'Uncategorized'])

/** True iff `name` is one of the "default place" sentinel literals. */
export function isDefaultPlace(name: string): boolean {
  return DEFAULT_PLACE_NAMES.has(name)
}
