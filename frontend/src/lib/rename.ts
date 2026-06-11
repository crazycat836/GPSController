/**
 * Shared commit step for every inline-rename input in the app: trim the
 * draft, skip empty / unchanged / unknown-target commits, and only then
 * fire the rename callback. Callers stay responsible for clearing their
 * own "editing id" state — orderings differ per site and are preserved.
 */
export function commitTrimmedRename(
  draft: string,
  currentName: string | undefined,
  rename: (name: string) => void | Promise<void>,
): void {
  const next = draft.trim()
  if (!next || currentName === undefined || next === currentName) return
  void rename(next)
}
