// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'
import type { TonoConnectProgress, TonoStatus } from '@/services/tono'

const mocks = vi.hoisted(() => ({
  status: {} as TonoStatus,
  progress: undefined as TonoConnectProgress | undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  select: vi.fn(),
  retry: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
  now: 0,
  aiTotal: null as string | null,
  aiMount: vi.fn(),
  aiUnmount: vi.fn(),
}))
vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({
    status: mocks.status,
    mutateTonoStatus: mocks.refresh,
  }),
  tonoConnectProgressQueryKey: ['tonoConnectProgress'],
  tonoServersQueryKey: ['tonoServers'],
}))
vi.mock('@/hooks/use-traffic-data', () => ({
  useTrafficData: () => ({
    response: { data: undefined },
    live: false,
    refreshGetClashTraffic: vi.fn(),
  }),
}))
vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))
vi.mock('@/services/query-client', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === 'tonoConnectProgress'
        ? mocks.progress
        : queryKey[0] === 'tonoServers'
          ? [
              { name: 'Tokyo · Sakura', selected: true, available: true },
              { name: 'Buffalo · Niagara', selected: false, available: true },
            ]
          : queryKey[1] === 'route-preferences'
            ? {
                scope: 'scope',
                catalogRevision: 1,
                favorites: ['Buffalo · Niagara'],
                recent: [
                  {
                    name: 'Tokyo · Sakura',
                    revision: 1,
                    verifiedAtMs: mocks.now - 1000,
                  },
                ],
                fixedRegion: null,
              }
            : undefined,
    refetch: mocks.refresh,
  }),
}))
vi.mock('@/services/tono', async (original) => ({
  ...(await original<typeof import('@/services/tono')>()),
  tonoConnect: mocks.connect,
  tonoDisconnect: mocks.disconnect,
  tonoSelectServer: mocks.select,
  tonoRetryNow: mocks.retry,
  tonoStatus: async () => mocks.status,
  subscribeTonoStatus: () => () => {},
}))
vi.mock('@/tono-ui/tono-toast-context', () => ({
  useTonoToast: () => mocks.toast,
}))
vi.mock('@/tono-ui/AiTrafficCard', async () => {
  const { useEffect } = await import('react')
  return {
    AiTrafficCard: ({
      onTodayTotal,
    }: {
      onTodayTotal?: (
        total: string | null,
        scope: string | null | undefined,
      ) => void
    }) => {
      // The owner report may arrive later than a status push, as a real account read does.
      useEffect(() => {
        if (mocks.aiTotal !== null)
          onTodayTotal?.(mocks.aiTotal, mocks.status.routePreferenceScope)
      }, [onTodayTotal])
      useEffect(() => {
        mocks.aiMount()
        return () => mocks.aiUnmount()
      }, [])
      return <div data-testid="ai-mounted" />
    },
  }
})
import DashboardPage from './dashboard'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})
const view = () => (
  <MemoryRouter>
    <DashboardPage />
  </MemoryRouter>
)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.now = Date.now()
  mocks.aiTotal = null
  localStorage.setItem(
    'tono-ui-preferences',
    JSON.stringify({ newAppearance: true, motion: 'static' }),
  )
  mocks.status = {
    accountState: 'ready',
    uiState: 'notConnected',
    stage: null,
    stageLabel: null,
    selectedServer: 'Tokyo · Sakura',
    protectionBlocked: false,
    killSwitch: null,
    catalogRevision: 1,
    catalogRequiresChoice: false,
    controllerGeneration: 1,
    routePreferenceScope: 'scope',
  }
  mocks.progress = undefined
  mocks.connect.mockResolvedValue(undefined)
  mocks.disconnect.mockResolvedValue(undefined)
  mocks.select.mockResolvedValue(undefined)
  mocks.refresh.mockResolvedValue({ data: mocks.status })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('renders a failed scene, never sunshine, when connected has no live protection evidence', () => {
  mocks.status.uiState = 'connected'
  const { container } = render(view())
  expect(
    container.querySelector('.sea-scene')?.getAttribute('data-phase'),
  ).toBe('failed')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'Protection not verified',
  )
})

it('keeps AI traffic mounted while details open and close', () => {
  render(view())
  expect(screen.getByTestId('ai-mounted')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Details' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(mocks.aiMount).toHaveBeenCalledTimes(1)
  expect(mocks.aiUnmount).not.toHaveBeenCalled()
})
it('keeps protected-offline retry, restore, diagnostics and route actions without released-network copy', () => {
  mocks.status.uiState = 'protectedOffline'
  mocks.status.protectionBlocked = true
  mocks.status.killSwitch = {
    wanted: true,
    live: true,
  } as TonoStatus['killSwitch']
  mocks.progress = {
    steps: [],
    totalElapsedMs: 1000,
    failedStage: null,
    error: 'handshake eof',
    retryAttempt: 1,
    nextRetryAtMs: null,
  }
  const { container } = render(view())
  expect(
    container.querySelector('.sea-scene')?.getAttribute('data-phase'),
  ).toBe('failed')
  expect(screen.getAllByRole('button', { name: 'Retry Now' }).length).toBe(1)
  expect(
    screen.getAllByRole('button', { name: 'Restore Normal Internet' }).length,
  ).toBe(1)
  expect(
    screen.getByRole('button', { name: 'Copy details', hidden: true }),
  ).toBeDefined()
  expect(screen.getByTestId('tono-home-line-chip')).toBeDefined()
  expect(screen.queryByText(enTono.progress.releasedFailureBody)).toBeNull()
})
it('selects a popover row through the existing select-then-idle-connect path exactly once', async () => {
  render(view())
  fireEvent.click(screen.getByTestId('tono-home-line-chip'))
  const row = await screen.findByRole('button', { name: /Buffalo/ })
  fireEvent.click(row)
  fireEvent.click(row)
  await waitFor(() => expect(mocks.select).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1))
  expect(mocks.select).toHaveBeenCalledWith('Buffalo · Niagara')
  expect(mocks.toast).toHaveBeenCalledTimes(1)
})
it('offers a manual line switch only after twenty seconds of connecting', () => {
  vi.useFakeTimers()
  mocks.status.uiState = 'connecting'
  mocks.status.stage = 'startingTunnel'
  render(view())
  expect(screen.queryByRole('button', { name: 'Switch line' })).toBeNull()
  act(() => {
    vi.advanceTimersByTime(8000)
  })
  expect(screen.getByTestId('tono-home-sentence').textContent).toContain(
    'taking a little longer',
  )
  act(() => {
    vi.advanceTimersByTime(11999)
  })
  expect(screen.queryByRole('button', { name: 'Switch line' })).toBeNull()
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(screen.getByRole('button', { name: 'Switch line' })).toBeDefined()
  expect(mocks.select).not.toHaveBeenCalled()
})
it('traps sheet focus and returns it to Details on Escape', () => {
  render(view())
  const trigger = screen.getByRole('button', { name: 'Details' })
  trigger.focus()
  fireEvent.click(trigger)
  expect(
    screen
      .getByRole('dialog', { name: 'Details' })
      .contains(document.activeElement),
  ).toBe(true)
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(
    screen
      .getByRole('dialog', { name: 'Details' })
      .contains(document.activeElement),
  ).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
})
it('keeps the legacy overview when the appearance switch is off', () => {
  localStorage.removeItem('tono-ui-preferences')
  const { container } = render(view())
  expect(container.querySelector('.sea-scene')).toBeNull()
  expect(screen.getByText(enTono.dashboard.title)).toBeDefined()
})
it('shows the first protected-connect hint only on its first home visit', () => {
  mocks.status.uiState = 'connected'
  mocks.status.killSwitch = {
    wanted: true,
    live: true,
  } as TonoStatus['killSwitch']
  const first = render(view())
  expect(screen.getByText(enTono.home.firstRun)).toBeDefined()
  first.unmount()
  render(view())
  expect(screen.queryByText(enTono.home.firstRun)).toBeNull()
})

it('keeps clean steps collapsed but opens their existing failure record automatically', () => {
  mocks.status.uiState = 'connecting'
  mocks.status.stage = 'startingTunnel'
  mocks.progress = {
    steps: [
      { key: 'startingTunnel', label: '', state: 'current', elapsedMs: 1000 },
    ],
    totalElapsedMs: 1000,
    failedStage: null,
    error: null,
    retryAttempt: 0,
    nextRetryAtMs: null,
  }
  const home = render(view())
  expect(screen.getByText('View steps').closest('details')?.open).toBe(false)
  mocks.progress = {
    ...mocks.progress,
    error: 'handshake eof',
    failedStage: 'startingTunnel',
  }
  home.rerender(view())
  expect(screen.getByText('View steps').closest('details')?.open).toBe(true)
})
it('starts the sunset in the same commit as the authoritative disconnecting title', () => {
  mocks.status.uiState = 'connected'
  mocks.status.killSwitch = {
    wanted: true,
    live: true,
  } as TonoStatus['killSwitch']
  const home = render(view())
  expect(
    home.container.querySelector('.sea-scene')?.getAttribute('data-phase'),
  ).toBe('connected')
  mocks.status = { ...mocks.status, uiState: 'disconnecting' }
  home.rerender(view())
  expect(
    home.container.querySelector('.sea-scene')?.getAttribute('data-phase'),
  ).toBe('idle')
  expect(
    screen
      .getByRole('heading', { level: 1 })
      .querySelector('.tono-home__text-in')?.textContent,
  ).toBe(enTono.home.title.disconnecting)
  expect(
    screen
      .getByRole('button', { name: enTono.pill.title.disconnecting })
      .hasAttribute('disabled'),
  ).toBe(true)
})
it('keeps the protected cancellation confirmation instead of directly releasing the barrier', () => {
  mocks.status.uiState = 'connecting'
  mocks.status.protectionBlocked = true
  render(view())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel connection' }))
  expect(screen.getByText(enTono.progress.restoreConfirmTitle)).toBeDefined()
  expect(mocks.disconnect).not.toHaveBeenCalled()
})
it('updates the protected duration once a minute without animating the numeric change', () => {
  vi.useFakeTimers()
  mocks.status.uiState = 'connected'
  mocks.status.killSwitch = {
    wanted: true,
    live: true,
  } as TonoStatus['killSwitch']
  render(view())
  const sentence = screen
    .getByTestId('tono-home-sentence')
    .querySelector('.tono-home__text-in')
  act(() => {
    vi.advanceTimersByTime(59_999)
  })
  expect(sentence?.textContent).toContain('Just connected')
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(
    screen
      .getByTestId('tono-home-sentence')
      .querySelector('.tono-home__text-in'),
  ).toBe(sentence)
  expect(sentence?.textContent).toContain('Protected for 1 minute')
})

it('hides an earlier owner AI summary immediately when the account scope changes', () => {
  mocks.status.uiState = 'connected'
  mocks.status.killSwitch = {
    wanted: true,
    live: true,
  } as TonoStatus['killSwitch']
  mocks.aiTotal = '123 MB'
  const home = render(view())
  expect(
    home.container.querySelector('.tono-home__telemetry')?.textContent,
  ).toContain('123 MB')
  mocks.status = { ...mocks.status, routePreferenceScope: 'replacement-scope' }
  home.rerender(view())
  expect(
    home.container.querySelector('.tono-home__telemetry')?.textContent,
  ).not.toContain('123 MB')
})

it('does not claim an automatic retry when the protected-offline record has no timer', () => {
  mocks.status.uiState = 'protectedOffline'
  mocks.status.killSwitch = {
    wanted: true,
    live: true,
  } as TonoStatus['killSwitch']
  mocks.progress = {
    steps: [],
    totalElapsedMs: null,
    failedStage: null,
    error: null,
    retryAttempt: 1,
    nextRetryAtMs: null,
  }
  render(view())
  expect(screen.getByTestId('tono-home-sentence').textContent).toContain(
    'No automatic retry is scheduled',
  )
  expect(screen.queryByText(enTono.experience.recoveryTitle)).toBeNull()
})

it('counts down the same scheduled retry as the progress record without inventing one', () => {
  vi.useFakeTimers()
  mocks.status.uiState = 'protectedOffline'
  mocks.status.killSwitch = {
    wanted: true,
    live: true,
  } as TonoStatus['killSwitch']
  mocks.progress = {
    steps: [],
    totalElapsedMs: null,
    failedStage: null,
    error: null,
    retryAttempt: 1,
    nextRetryAtMs: Date.now() + 5000,
  }
  render(view())
  expect(screen.getByTestId('tono-home-sentence').textContent).toContain(
    'Retrying automatically in 5 seconds',
  )
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(screen.getByTestId('tono-home-sentence').textContent).toContain(
    'Retrying automatically in 4 seconds',
  )
})

it('shows a released failure sentence and retry only once, with secondary tools hidden in the card technical details', () => {
  mocks.progress = {
    steps: [],
    totalElapsedMs: 1000,
    failedStage: 'startingTunnel',
    error: 'handshake eof',
    retryAttempt: 0,
    nextRetryAtMs: null,
  }
  const { container } = render(view())
  expect(screen.getAllByText(enTono.progress.releasedFailureBody)).toHaveLength(
    1,
  )
  expect(
    screen.getAllByRole('button', { name: enTono.dashboard.errorRetry }),
  ).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Retry Now' })).toBeNull()
  const technical = screen
    .getByText(enTono.progress.technicalDetails)
    .closest('details')
  expect(technical?.open).toBe(false)
  expect(container.querySelector('.tono-home__tools')?.closest('details')).toBe(
    technical,
  )
  expect(
    container.querySelector('.tono-home__progress-card')?.contains(technical),
  ).toBe(true)
})

it('uses the selected chip name and measured exit latency in the checked popover row', async () => {
  mocks.status.exitDelayMs = 83
  render(view())
  fireEvent.click(screen.getByTestId('tono-home-line-chip'))
  const row = await within(
    screen.getByRole('dialog', { name: 'Switch line' }),
  ).findByRole('button', { name: /Sakura.*Tokyo/ })
  expect(within(row).getByText('83 ms')).toBeDefined()
  expect(row.getAttribute('aria-pressed')).toBe('true')
  expect(
    row.querySelector('[data-testid="tono-home-selected-check"]'),
  ).not.toBeNull()
})

it('removes the trailing stage ellipsis before the slow sentence suffix', () => {
  vi.useFakeTimers()
  mocks.status.uiState = 'connecting'
  mocks.status.stage = 'startingTunnel'
  render(view())
  act(() => {
    vi.advanceTimersByTime(8000)
  })
  expect(
    screen
      .getByTestId('tono-home-sentence')
      .querySelector('.tono-home__text-in')?.textContent,
  ).not.toMatch(/(?:\.\.\.|…)/)
})

it('keeps the line picker below the chip instead of covering the title when neither side has room', () => {
  // 860×540 English: the sentence wraps to three lines, the chip bottom sits at 399,
  // 125px remain below and only 45px between the sentence and the chip above.
  const original = HTMLElement.prototype.getBoundingClientRect
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('tono-home'))
        return new DOMRect(0, 0, 860, 540)
      if (this.classList.contains('tono-home__chip'))
        return new DOMRect(163, 351, 206, 48)
      if (this.classList.contains('tono-home__sentence'))
        return new DOMRect(56, 195, 400, 103)
      return original.call(this)
    })
  try {
    render(view())
    fireEvent.click(screen.getByTestId('tono-home-line-chip'))
    const panel = screen.getByRole('dialog', { name: 'Switch line' })
    expect(panel.style.top).toBe('407px')
    expect(panel.style.maxHeight).toBe('125px')
  } finally {
    geometry.mockRestore()
  }
})

it('opens a scrollable line picker downward when 255 pixels remain below the chip', () => {
  const original = HTMLElement.prototype.getBoundingClientRect
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('tono-home'))
        return new DOMRect(0, 0, 920, 600)
      if (this.classList.contains('tono-home__chip'))
        return new DOMRect(163, 281, 206, 48)
      return original.call(this)
    })
  try {
    render(view())
    fireEvent.click(screen.getByTestId('tono-home-line-chip'))
    const panel = screen.getByRole('dialog', { name: 'Switch line' })
    expect(panel.style.top).toBe('337px')
    expect(panel.style.maxHeight).toBe('255px')
    expect(panel.style.overflowY).toBe('auto')
  } finally {
    geometry.mockRestore()
  }
})
