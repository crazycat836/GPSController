/**
 * Local-only UI usage log.
 *
 * Captures interaction events automatically — no per-component `track()`
 * calls — and batches them to `POST /api/usage/events`, which appends them
 * to `~/.gpscontroller/usage/usage-YYYY-MM.jsonl`. `tools/usage_report.py`
 * turns that file into feature-usage / clicks-per-action / abandoned-dialog
 * tables.
 *
 * Sources:
 * - `click` / `key`: document-level capture listeners. Region comes from the
 *   nearest `data-fc` ancestor, label from aria-label / title / text / icon.
 * - `dialog_open` / `dialog_close`: `useDialogUsage`, called from
 *   `useFocusTrap` — every modal, drawer and popover traps focus.
 * - `api`: the `http.ts` request observer. Non-GET only (GETs are polling
 *   and hydration, not user actions); path + status, never bodies.
 *
 * Privacy: nothing leaves the machine; input values are never read, and
 * coordinate-looking numbers in labels are masked.
 */
import { useEffect, type RefObject } from 'react'
import { API_BASE } from '../lib/constants'
import { authedFetch, setRequestObserver, type RequestOutcome } from './http'

export type UsageEventType = 'click' | 'key' | 'dialog_open' | 'dialog_close' | 'api'

export interface UsageEvent {
  ts: number
  session: string
  /** `dev` for Vite-served sessions (incl. `start.py`); `--exclude-dev` drops them. */
  env: 'dev' | 'prod'
  type: UsageEventType
  region?: string
  label?: string
  method?: string
  path?: string
  status?: number
  ok?: boolean
  code?: string
  ms?: number
}

const ENDPOINT = '/api/usage/events'
const FLUSH_INTERVAL_MS = 10_000
const FLUSH_THRESHOLD = 50
const MAX_BUFFER = 500
const LABEL_MAX = 40

const session = Math.random().toString(36).slice(2, 10)
const env: UsageEvent['env'] = import.meta.env.DEV ? 'dev' : 'prod'
let buffer: UsageEvent[] = []

export function recordUsage(event: Omit<UsageEvent, 'ts' | 'session' | 'env'>): void {
  buffer.push({ ts: Date.now(), session, env, ...event })
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER)
  if (buffer.length >= FLUSH_THRESHOLD) void flushUsage()
}

/** Send buffered events. Failures drop nothing; the next flush retries. */
export async function flushUsage(keepalive = false): Promise<void> {
  if (buffer.length === 0) return
  const batch = buffer
  buffer = []
  try {
    const res = await authedFetch(`${API_BASE}${ENDPOINT}`, (headers) => ({
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive,
    }))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch {
    buffer = [...batch, ...buffer].slice(-MAX_BUFFER)
  }
}

// ── Label / region extraction ─────────────────────────────

const INTERACTIVE_SELECTOR =
  'button, a, select, label, input, textarea, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]'

/** Collapse whitespace, mask coordinate-like numbers, cap length. */
export function cleanLabel(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw.replace(/-?\d+\.\d{3,}/g, '#').replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  return s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX)}…` : s
}

function iconName(el: Element): string | undefined {
  const cls = el.querySelector('svg')?.getAttribute('class') ?? ''
  const m = cls.match(/lucide-([\w-]+)/)
  return m ? `icon:${m[1]}` : undefined
}

function labelFor(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    // Never the value — only what the field is.
    const kind = tag === 'input' ? `input:${(el as HTMLInputElement).type}` : tag
    const name = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.getAttribute('name')
    return cleanLabel(name ? `${kind} ${name}` : kind)
  }
  return (
    cleanLabel(el.getAttribute('aria-label')) ??
    cleanLabel(el.getAttribute('title')) ??
    cleanLabel(el.textContent) ??
    iconName(el) ??
    tag
  )
}

function regionFor(el: Element): string | undefined {
  return el.closest('[data-fc]')?.getAttribute('data-fc') ?? undefined
}

/** Describe a click target, or null when the click isn't worth logging. */
export function describeClick(target: EventTarget | null, isContextMenu = false): { region?: string; label?: string } | null {
  if (!(target instanceof Element)) return null
  const interactive = target.closest(INTERACTIVE_SELECTOR)
  if (interactive) return { region: regionFor(interactive), label: labelFor(interactive) }
  if (target.closest('.leaflet-container')) {
    return { region: regionFor(target) ?? 'map.canvas', label: isContextMenu ? 'right-click' : 'click' }
  }
  return null
}

/** Strip query strings and collapse id-like path segments to `:id`. */
export function normalizeApiPath(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((seg) => (seg.length >= 6 && /\d/.test(seg) && /^[\w-]+$/.test(seg) ? ':id' : seg))
    .join('/')
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** Keys that act as shortcuts. Joystick movement keys are excluded on purpose. */
function shortcutName(e: KeyboardEvent): string | null {
  if (e.repeat || isEditable(e.target)) return null
  const mod = e.metaKey ? 'Meta+' : e.ctrlKey ? 'Ctrl+' : ''
  if (mod && e.key.length === 1) return `${mod}${e.key.toLowerCase()}`
  if (e.key === 'Escape' || e.key === ' ' || /^[1-9]$/.test(e.key)) return e.key === ' ' ? 'Space' : e.key
  return null
}

function onRequest(o: RequestOutcome): void {
  if (o.method.toUpperCase() === 'GET' || o.path.startsWith(ENDPOINT)) return
  recordUsage({
    type: 'api',
    method: o.method.toUpperCase(),
    path: normalizeApiPath(o.path),
    status: o.status,
    ok: o.ok,
    code: o.code,
    ms: o.ms,
  })
}

/** Install every automatic capture source. Returns a teardown. */
export function installUsageCapture(): () => void {
  const onClick = (e: MouseEvent) => {
    const d = describeClick(e.target, e.type === 'contextmenu')
    if (d) recordUsage({ type: 'click', ...d })
  }
  const onKey = (e: KeyboardEvent) => {
    const key = shortcutName(e)
    if (key) recordUsage({ type: 'key', label: key, region: e.target instanceof Element ? regionFor(e.target) : undefined })
  }
  const onPageHide = () => void flushUsage(true)

  document.addEventListener('click', onClick, true)
  document.addEventListener('contextmenu', onClick, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('pagehide', onPageHide)
  setRequestObserver(onRequest)
  const timer = setInterval(() => void flushUsage(), FLUSH_INTERVAL_MS)

  return () => {
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('contextmenu', onClick, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('pagehide', onPageHide)
    setRequestObserver(null)
    clearInterval(timer)
    void flushUsage(true)
  }
}

/** Mount the capture once for the app's lifetime. */
export function useUsageCapture(): void {
  useEffect(() => installUsageCapture(), [])
}

function dialogName(el: HTMLElement): string | undefined {
  const labelledBy = el.getAttribute('aria-labelledby')
  return (
    regionFor(el) ??
    cleanLabel(el.getAttribute('aria-label')) ??
    cleanLabel(labelledBy ? document.getElementById(labelledBy)?.textContent : undefined)
  )
}

/** Record open/close of a modal surface while `open` is true. */
export function useDialogUsage(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open || !ref.current) return
    const region = dialogName(ref.current)
    recordUsage({ type: 'dialog_open', region })
    return () => recordUsage({ type: 'dialog_close', region })
  }, [open, ref])
}

/** Test-only: inspect and reset the buffer. */
export const __usageTest = {
  peek: () => buffer,
  reset: () => { buffer = [] },
}
