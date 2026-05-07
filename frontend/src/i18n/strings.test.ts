import { describe, it, expect } from 'vitest'
import { BACKEND_ERROR_CODES } from '../generated/api-contract'
import { STRINGS } from './strings'

// Contract test: every backend error code in `ErrorCode` (mirrored
// into `BACKEND_ERROR_CODES` by tools/gen_ws_types.py) MUST have a
// matching `err.<code>` translation in `STRINGS`. A failure here
// means either:
//   - the backend added a new code without adding an `err.*` entry
//     (frontend will show the raw English fallback), OR
//   - the frontend deleted an `err.*` entry that's still emitted by
//     the backend.
//
// Either way it's a drift the user-facing toast layer would silently
// hide; this test makes it impossible to merge.
describe('i18n contract: BACKEND_ERROR_CODES vs STRINGS', () => {
  it('every backend error code has an err.<code> translation', () => {
    const missing: string[] = []
    for (const code of BACKEND_ERROR_CODES) {
      const key = `err.${code}` as keyof typeof STRINGS
      if (!(key in STRINGS)) missing.push(code)
    }
    expect(missing).toEqual([])
  })

  it('every err.* entry has both zh and en strings (no half-translations)', () => {
    const halfTranslated: string[] = []
    for (const code of BACKEND_ERROR_CODES) {
      const key = `err.${code}` as keyof typeof STRINGS
      const entry = STRINGS[key] as { zh?: string; en?: string } | undefined
      if (!entry) continue // covered by the test above
      if (!entry.zh || !entry.en) halfTranslated.push(code)
    }
    expect(halfTranslated).toEqual([])
  })
})
