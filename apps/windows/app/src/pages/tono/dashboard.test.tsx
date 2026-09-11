// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'
import type { TonoStatus } from '@/services/tono'

const mocks = vi.hoisted(() => ({
  status: undefined as unknown,
  mutateTonoStatus: vi.fn(),
  tonoConnect: vi.fn(),
  tonoDisconnect: vi.fn(),
  tonoRetryNow: vi.fn(),
  trafficLive: false,
  traffic: undefined as { up: number; down: number } | undefined,
  refreshGetClashTraffic: vi.fn(),
}))

vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({
    status: mocks.status,
    mutateTonoStatus: mocks.mutateTonoStatus,
  }),
}))

vi.mock('@/hooks/use-traffic-data', () => ({
  useTrafficData: () => ({
    response: { data: mocks.traffic },
    live: mocks.trafficLive,
    refreshGetClashTraffic: mocks.refreshGetClashTraffic,
  }),
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))

vi.mock('@/services/tono', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tono')>()),
  tonoConnect: mocks.tonoConnect,
  tonoDisconnect: mocks.tonoDisconnect,
  tonoRetryNow: mocks.tonoRetryNow,
}))

vi.mock('./connect-progress', () => ({ ConnectProgressCard: () => null }))

import DashboardPage from './dashboard'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})

const makeStatus = (overrides: Partial<TonoStatus> = {}): TonoStatus => ({
  accountState: 'ready',
  uiState: 'notConnected',
  stage: null,
  stageLabel: null,
  selectedServer: null,
  protectionBlocked: false,
  killSwitch: null,
  catalogRevision: 1,
  catalogRequiresChoice: false,
  controllerGeneration: 1,
  ...overrides,
})

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  mocks.status = makeStatus()
  mocks.mutateTonoStatus.mockReset().mockResolvedValue({ data: makeStatus() })
  mocks.tonoConnect.mockReset().mockResolvedValue(undefined)
  mocks.tonoDisconnect.mockReset().mockResolvedValue(undefined)
  mocks.tonoRetryNow.mockReset().mockResolvedValue(undefined)
  mocks.trafficLive = false
  mocks.traffic = undefined
  mocks.refreshGetClashTraffic.mockReset()
})

afterEach(() => cleanup())

describe('dashboard action-error ownership', () => {
  it('does not claim protection when startup has no Service barrier evidence', () => {
    mocks.status = makeStatus({ uiState: 'protectedOffline', protectionBlocked: true })
    renderDashboard()
    expect(screen.getByRole('button', {
      name: 'Protection not verified — Click to restore internet',
    })).toBeDefined()
    expect(screen.queryByText('Protected, not connected')).toBeNull()
  })

  it('retries a failed disconnect with disconnect and never offers a server switch', async () => {
    mocks.status = makeStatus({
      uiState: 'connected',
      selectedServer: 'US West 1',
    })
    mocks.tonoDisconnect.mockRejectedValue(new Error('release failed'))
    renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Connected — Click to disconnect',
      }),
    )
    await screen.findByRole('alert')

    expect(screen.queryByRole('button', { name: 'Switch server' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(mocks.tonoDisconnect).toHaveBeenCalledTimes(2))
    expect(mocks.tonoConnect).not.toHaveBeenCalled()
    expect(mocks.tonoRetryNow).not.toHaveBeenCalled()
  })

  it('will not release fail-closed protection from the pill without a confirmation', async () => {
    mocks.status = makeStatus({
      killSwitch: { wanted: true, live: true, mode: 'blocked', endpoints: [], last_error: null },
      uiState: 'protectedOffline',
      selectedServer: 'US West 1',
      protectionBlocked: true,
    })
    renderDashboard()

    const pill = screen.getByRole('button', {
      name: 'Protected, not connected — Click to restore internet',
    })
    fireEvent.click(pill)

    // The click opens the same confirmation the progress card has always used;
    // protection must not drop on the click itself.
    expect(mocks.tonoDisconnect).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Restore Normal Internet' }),
    )
    await waitFor(() => expect(mocks.tonoDisconnect).toHaveBeenCalled())
  })

  it('does not render a second error box once protected offline owns the failure', async () => {
    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    mocks.mutateTonoStatus.mockResolvedValue({
      data: makeStatus({
        uiState: 'protectedOffline',
        selectedServer: 'US West 1',
        protectionBlocked: true,
      }),
    })
    mocks.tonoConnect.mockRejectedValue(
      new Error('TONO_NODE_OR_CORE_UNREACHABLE: all probes failed'),
    )
    const view = renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Standby — Click to connect',
      }),
    )
    await waitFor(() => expect(mocks.tonoConnect).toHaveBeenCalled())

    mocks.status = makeStatus({
      uiState: 'protectedOffline',
      selectedServer: 'US West 1',
      protectionBlocked: true,
    })
    view.rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId('tono-action-error-message')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retires a protected-offline error after the scheduled reconnect succeeds', async () => {
    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    mocks.mutateTonoStatus.mockResolvedValue({
      data: makeStatus({
        uiState: 'protectedOffline',
        selectedServer: 'US West 1',
        protectionBlocked: true,
      }),
    })
    mocks.tonoConnect.mockRejectedValue(
      new Error('TONO_NODE_OR_CORE_UNREACHABLE: all probes failed'),
    )
    const view = renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Standby — Click to connect',
      }),
    )
    await waitFor(() => expect(mocks.tonoConnect).toHaveBeenCalled())

    mocks.status = makeStatus({
      uiState: 'connected',
      selectedServer: 'US West 1',
    })
    view.rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(mocks.tonoRetryNow).not.toHaveBeenCalled()
  })

  it('drops a stale retry-now banner after protection is released', async () => {
    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    mocks.mutateTonoStatus.mockResolvedValue({
      data: makeStatus({
        uiState: 'protectedOffline',
        selectedServer: 'US West 1',
        protectionBlocked: true,
      }),
    })
    mocks.tonoConnect.mockRejectedValue(
      new Error('TONO_NODE_OR_CORE_UNREACHABLE: all probes failed'),
    )
    const view = renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Standby — Click to connect',
      }),
    )
    await waitFor(() => expect(mocks.tonoConnect).toHaveBeenCalled())

    mocks.status = makeStatus({
      uiState: 'protectedOffline',
      selectedServer: 'US West 1',
      protectionBlocked: true,
    })
    view.rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('alert')).toBeNull()

    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    view.rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Standby — Click to connect',
      }),
    )
    await waitFor(() => expect(mocks.tonoConnect).toHaveBeenCalledTimes(2))
    expect(mocks.tonoRetryNow).not.toHaveBeenCalled()
  })

  it('keeps long action errors inside the narrow dashboard content area', async () => {
    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    mocks.tonoConnect.mockRejectedValue(
      new Error(`TONO_SERVICE_BUSY: ${'unbroken-error-detail-'.repeat(20)}`),
    )
    renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Standby — Click to connect',
      }),
    )
    const alert = await screen.findByRole('alert')
    const message = alert.querySelector(
      '[data-testid="tono-action-error-message"]',
    ) as HTMLElement
    const actions = alert.lastElementChild as HTMLElement

    expect(alert.style.boxSizing).toBe('border-box')
    expect(alert.style.minWidth).toBe('0px')
    expect(message.style.overflowWrap).toBe('anywhere')
    expect(actions.style.flexWrap).toBe('wrap')
    expect(actions.style.maxWidth).toBe('100%')
  })

  it('retries an ordinary idle service failure with connect and no server switch', async () => {
    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    mocks.mutateTonoStatus.mockResolvedValue({
      data: makeStatus({ selectedServer: 'US West 1' }),
    })
    mocks.tonoConnect.mockRejectedValue(
      new Error('TONO_SERVICE_BUSY: repair pending'),
    )
    renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Standby — Click to connect',
      }),
    )
    await screen.findByRole('alert')

    expect(screen.queryByRole('button', { name: 'Switch server' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(mocks.tonoConnect).toHaveBeenCalledTimes(2))
    expect(mocks.tonoRetryNow).not.toHaveBeenCalled()
    expect(mocks.tonoDisconnect).not.toHaveBeenCalled()
  })
})

describe('dashboard cancel while connecting', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores a pill click inside the 1.2s grace and disconnects after it', async () => {
    vi.useFakeTimers()
    mocks.status = makeStatus({
      uiState: 'connecting',
      selectedServer: 'US West 1',
      stage: 'lockingTraffic',
    })
    renderDashboard()

    const pill = screen.getByRole('button', { name: /^Cancel/ })
    expect((pill as HTMLButtonElement).disabled).toBe(false)
    expect(pill.getAttribute('aria-disabled')).toBeNull()

    fireEvent.click(pill)
    expect(mocks.tonoDisconnect).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1199)
    fireEvent.click(pill)
    expect(mocks.tonoDisconnect).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    fireEvent.click(pill)
    await Promise.resolve()
    expect(mocks.tonoDisconnect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('dashboard live traffic copy', () => {
  it('does not present 0 B/s as live throughput before the core feed arrives', () => {
    mocks.status = makeStatus({
      uiState: 'connected',
      selectedServer: 'US West 1',
    })
    mocks.trafficLive = false
    renderDashboard()

    expect(screen.getByText('Reading traffic…')).toBeDefined()
    expect(screen.queryByText(/0 B\/s/)).toBeNull()
  })

  it('shows the live rate once the traffic socket has delivered a frame', () => {
    mocks.status = makeStatus({
      uiState: 'connected',
      selectedServer: 'US West 1',
    })
    mocks.trafficLive = true
    mocks.traffic = { up: 2048, down: 4096 }
    renderDashboard()

    expect(screen.queryByText('Reading traffic…')).toBeNull()
    expect(screen.getByText('4.00 KB/s')).toBeDefined()
  })
})

describe('dashboard claude residential route badge', () => {
  it('renders claude residential active badge when connected and home is active', () => {
    mocks.status = makeStatus({
      uiState: 'connected',
      selectedServer: 'US West 1',
      claudeHomeActive: true,
    })
    renderDashboard()

    expect(
      screen.getByText('Claude / AI Residential Route: Active'),
    ).toBeDefined()
    expect(
      screen.getByText(/profile-level routing is unavailable/),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'View Rules' })).toBeDefined()
  })

  it('renders standard protection badge when connected and home is not active', () => {
    mocks.status = makeStatus({
      uiState: 'connected',
      selectedServer: 'US West 1',
      claudeHomeActive: false,
    })
    renderDashboard()

    expect(
      screen.getByText('Standard Cloud Protection (Data Center)'),
    ).toBeDefined()
  })

  it('opens protected rules dialog when clicking view rules button', () => {
    mocks.status = makeStatus({
      uiState: 'connected',
      selectedServer: 'US West 1',
      claudeHomeActive: true,
    })
    renderDashboard()

    fireEvent.click(screen.getByRole('button', { name: 'View Rules' }))
    expect(
      screen.getByText('Claude / AI Residential Protection Scope'),
    ).toBeDefined()
  })

  it('hides the first-connect checklist after handshake eof so the next hand is visible', async () => {
    mocks.status = makeStatus({ selectedServer: 'Tokyo · Sakura' })
    mocks.tonoConnect.mockRejectedValue(
      new Error(
        'TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof [CORE_EXIT_UNREACHABLE]',
      ),
    )
    renderDashboard()
    expect(screen.getByText('First connect')).toBeDefined()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Standby — Click to connect',
      }),
    )
    await waitFor(() => expect(screen.queryByText('First connect')).toBeNull())
    // Progress card owns Retry / Choose route. This box used to say
    // switching cities will not help, which hid the next hand.
    expect(screen.queryByTestId('tono-action-error-message')).toBeNull()
  })

  it('tells the customer to disconnect and reinstall when the update journal is Failed', () => {
    mocks.status = makeStatus({ updateIncomplete: true })
    renderDashboard()
    expect(
      screen.getByRole('alert').textContent,
    ).toBe('The update did not finish. Disconnect, then reinstall Tono.')
  })
})
