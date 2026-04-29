import { useConnectionHealth } from '../contexts/ConnectionHealthContext'
import { useT } from '../i18n'

/** Returned shape is friendly to spread onto a `<button>`:
 *
 * ```tsx
 * const conn = useDisabledByConnection()
 * <button disabled={!destPos || conn.disabled} title={conn.title}>
 * ```
 *
 * Centralising this means new gated controls don't have to remember to
 * (a) read `canOperate`, (b) wire the same i18n tooltip, (c) show the
 * tooltip only when the disable is health-driven (not when the panel
 * has its own precondition like "no destination yet"). */
export interface DisabledByConnection {
  /** True when the action should be disabled due to transport/device
   *  health. Combine with panel-local preconditions via OR. */
  disabled: boolean
  /** Tooltip explaining the health-driven disable, or `undefined` when
   *  health is fine — leaving the panel's own tooltip (if any) to show. */
  title: string | undefined
}

export function useDisabledByConnection(): DisabledByConnection {
  const { canOperate } = useConnectionHealth()
  const t = useT()
  return {
    disabled: !canOperate,
    title: !canOperate ? t('conn.not_ready_tooltip') : undefined,
  }
}
