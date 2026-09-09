// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import DdiFailedBanner from './DdiFailedBanner'

type DdiMissing = {
  reason: string
  stage?: string
  udid?: string
  hintKey?: string
  ts: number
} | null

const simState: { ddiMissing: DdiMissing; ddiMounting: boolean } = {
  ddiMissing: null,
  ddiMounting: false,
}
const showToast = vi.fn()
const revealDeveloperMode = vi.fn()

vi.mock('../../contexts/SimContext', () => ({
  useSimState: () => simState,
}))
vi.mock('../../contexts/ToastContext', () => ({
  useToastContext: () => ({ showToast }),
}))
vi.mock('../../services/api', () => ({
  revealDeveloperMode: (udid: string) => revealDeveloperMode(udid),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  simState.ddiMissing = null
  simState.ddiMounting = false
})

function renderBanner(ddiMissing: DdiMissing) {
  simState.ddiMissing = ddiMissing
  return render(
    <I18nProvider>
      <DdiFailedBanner />
    </I18nProvider>,
  )
}

describe('DdiFailedBanner', () => {
  it('renders the generic manual-mount hint when no hint_key is given', () => {
    renderBanner({ reason: 'RuntimeError: boom', ts: 1 })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/DDI/)
    expect(alert.textContent).not.toMatch(/開發者模式|Developer Mode/)
    expect(screen.queryByRole('button', { name: /顯示開發者模式|Reveal Developer Mode/ })).toBeNull()
  })

  it('renders the Developer Mode hint plus a reveal button when the backend says the toggle is off', async () => {
    revealDeveloperMode.mockResolvedValue(undefined)
    renderBanner({
      reason: 'developer_mode_disabled',
      stage: 'personalized',
      udid: 'udid-A',
      hintKey: 'ddi.developer_mode_disabled',
      ts: 1,
    })
    expect(screen.getByRole('alert').textContent).toMatch(/開發者模式|Developer Mode/)

    const reveal = screen.getByRole('button', { name: /顯示開發者模式|Reveal Developer Mode/ })
    fireEvent.click(reveal)
    await waitFor(() => expect(revealDeveloperMode).toHaveBeenCalledWith('udid-A'))
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1))
  })

  it('falls back to the Developer Mode hint from reason alone when hint_key is unknown', () => {
    renderBanner({ reason: 'developer_mode_disabled', udid: 'udid-A', hintKey: 'ddi.bogus', ts: 1 })
    expect(screen.getByRole('alert').textContent).toMatch(/開發者模式|Developer Mode/)
  })

  it('hides once a new mount attempt starts', () => {
    const { rerender } = renderBanner({ reason: 'x', ts: 1 })
    expect(screen.getByRole('alert')).toBeTruthy()
    simState.ddiMounting = true
    rerender(
      <I18nProvider>
        <DdiFailedBanner />
      </I18nProvider>,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
