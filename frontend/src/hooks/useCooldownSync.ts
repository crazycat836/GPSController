import { useEffect } from 'react'
import * as api from '../services/api'
import type { CooldownStatusResponse } from '../services/api'
import { devWarn } from '../lib/dev-log'
import type { WsMessage } from './useWebSocket'

type Subscriber = (cb: (msg: WsMessage) => void) => () => void

/**
 * Mirror the backend cooldown timer into local React state.
 *
 * On mount: one REST GET to seed `remaining` + `enabled`. Slow backend
 * startup or a transient connect failure is logged via `devWarn` (no
 * crash — the WS path will catch up once the server is up).
 *
 * For the lifetime of `subscribe`: the hook listens for
 * `cooldown_update` WS frames and forwards them through the supplied
 * setters. Both setters use functional updates so React can bail out of
 * pointless re-renders when the value hasn't materially changed.
 *
 * Lifted out of `SimContext.tsx` so the provider can stay focused on
 * dispatching simulation actions; the cooldown plumbing has nothing to
 * do with the rest of that surface.
 */
export function useCooldownSync(
  subscribe: Subscriber | undefined,
  setCooldown: React.Dispatch<React.SetStateAction<number>>,
  setCooldownEnabled: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  useEffect(() => {
    // Initial sync — one REST GET on mount, then WS frames take over.
    api.getCooldownStatus().then((s: CooldownStatusResponse) => {
      setCooldown(s.remaining_seconds ?? 0)
      if (typeof s.enabled === 'boolean') setCooldownEnabled(s.enabled)
    }).catch((err) => {
      // Slow backend startup or transient connect failure — don't crash
      // the WS subscriber chain; log in dev so it's still surfaced.
      devWarn('cooldown initial fetch failed', err)
    })

    if (!subscribe) return
    return subscribe((msg) => {
      if (msg.type !== 'cooldown_update') return
      // `unknown`-typed payload: cast to an index map so every field access
      // is forced through the runtime guards below rather than being trusted
      // via a structural cast.
      const d = msg.data as Record<string, unknown>
      // Guard the field rather than trusting the cast — a malformed frame
      // (e.g. a string remaining_seconds) would otherwise corrupt the
      // cooldown display. Matches the type-guard discipline in the sibling
      // WS dispatchers (device/parsers.ts, sim/useSimWsDispatcher.ts).
      const raw = d.remaining_seconds
      const next = typeof raw === 'number' ? raw : 0
      setCooldown((prev) => Math.round(prev) === Math.round(next) ? prev : next)
      if (typeof d.enabled === 'boolean') {
        const nextEnabled = d.enabled
        setCooldownEnabled((prev) => prev === nextEnabled ? prev : nextEnabled)
      }
    })
  }, [subscribe, setCooldown, setCooldownEnabled])
}
