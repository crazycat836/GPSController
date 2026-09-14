// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { cleanLabel, describeClick, normalizeApiPath, installUsageCapture, useDialogUsage, __usageTest } from './usage'
import { request, setRequestObserver } from './http'

afterEach(() => {
  cleanup()
  __usageTest.reset()
  setRequestObserver(null)
  vi.unstubAllGlobals()
})

describe('cleanLabel', () => {
  it('masks coordinates and truncates', () => {
    expect(cleanLabel('  25.03751, 121.56370 ')).toBe('#, #')
    expect(cleanLabel('x'.repeat(60))).toHaveLength(41)
    expect(cleanLabel('   ')).toBeUndefined()
  })
})

describe('normalizeApiPath', () => {
  it('drops query strings and collapses ids', () => {
    expect(normalizeApiPath('/api/location/stop?udid=00008110-ABC')).toBe('/api/location/stop')
    expect(normalizeApiPath('/api/bookmarks/3f2a9c1b-77')).toBe('/api/bookmarks/:id')
    expect(normalizeApiPath('/api/route/saved/import-gpx')).toBe('/api/route/saved/import-gpx')
  })
})

describe('describeClick', () => {
  it('uses nearest data-fc region and aria-label', () => {
    const { getByTestId } = render(
      <div data-fc="bottom.dock">
        <button aria-label="Start"><span data-testid="inner">▶</span></button>
      </div>,
    )
    expect(describeClick(getByTestId('inner'))).toEqual({ region: 'bottom.dock', label: 'Start' })
  })

  it('never reads input values', () => {
    const { getByRole } = render(<input type="text" placeholder="Search" defaultValue="secret place" />)
    expect(describeClick(getByRole('textbox'))).toEqual({ region: undefined, label: 'input:text Search' })
  })

  it('ignores clicks on non-interactive chrome', () => {
    const { getByTestId } = render(<div data-testid="plain">text</div>)
    expect(describeClick(getByTestId('plain'))).toBeNull()
  })
})

describe('installUsageCapture', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  })

  it('records clicks and shortcut keys, skipping typing', () => {
    const teardown = installUsageCapture()
    const { getByText, getByRole } = render(
      <div data-fc="topbar.actions"><button>Library</button><input type="text" /></div>,
    )
    fireEvent.click(getByText('Library'))
    fireEvent.keyDown(document.body, { key: '2' })
    fireEvent.keyDown(getByRole('textbox'), { key: '2' })

    expect(__usageTest.peek().map((e) => [e.type, e.region, e.label])).toEqual([
      ['click', 'topbar.actions', 'Library'],
      ['key', undefined, '2'],
    ])
    teardown()
  })

  it('records non-GET API calls without bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { status: 'ok' }, error: null }), { status: 200 },
    )))
    const teardown = installUsageCapture()
    await request('GET', '/api/location/status')
    await request('POST', '/api/location/teleport', { lat: 25.0375, lng: 121.5637 })

    const events = __usageTest.peek()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'api', method: 'POST', path: '/api/location/teleport', status: 200, ok: true })
    expect(JSON.stringify(events[0])).not.toContain('25.0375')
    teardown()
  })
})

describe('useDialogUsage', () => {
  function Dialog({ open }: { open: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useDialogUsage(ref, open)
    return <div data-fc="modal.save-route"><div ref={ref} role="dialog" /></div>
  }

  it('records open then close', () => {
    const { rerender } = render(<Dialog open={false} />)
    rerender(<Dialog open />)
    rerender(<Dialog open={false} />)
    expect(__usageTest.peek().map((e) => [e.type, e.region])).toEqual([
      ['dialog_open', 'modal.save-route'],
      ['dialog_close', 'modal.save-route'],
    ])
  })
})
