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

import enTono from '@/locales/en/tono.json'
import type { TonoStatus } from '@/services/tono'

const mocks = vi.hoisted(() => ({
  status: undefined as unknown,
  mutateTonoStatus: vi.fn(),
  tonoConnect: vi.fn(),
  tonoDisconnect: vi.fn(),
  tonoRetryNow: vi.fn(),
}))

vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({
    status: mocks.status,
    mutateTonoStatus: mocks.mutateTonoStatus,
  }),
}))

vi.mock('@/hooks/use-traffic-data', () => ({
  useTrafficData: () => ({ response: { data: undefined } }),
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
  resources: { en: { translation: { tono: enTono } } },
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
})

afterEach(() => cleanup())

describe('dashboard action-error ownership', () => {
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

  it('uses retry-now for an unreachable connect that entered protected offline', async () => {
    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    const failedStatus = makeStatus({
      uiState: 'protectedOffline',
      selectedServer: 'US West 1',
      protectionBlocked: true,
    })
    // The rendered hook remains stale; only the explicit post-failure status
    // read observes Protected Offline and assigns retry ownership.
    mocks.mutateTonoStatus.mockResolvedValue({ data: failedStatus })
    mocks.tonoConnect.mockRejectedValue(
      new Error('TONO_NODE_OR_CORE_UNREACHABLE: all probes failed'),
    )
    const view = renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Not Connected — Click to connect',
      }),
    )
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: 'Switch server' })).toBeDefined()
    // A later push can advance the scheduled reconnect. Retry must keep the
    // command owner captured with the failure rather than consult this state.
    mocks.status = makeStatus({
      uiState: 'connecting',
      selectedServer: 'US West 1',
      protectionBlocked: true,
    })
    view.rerender(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(mocks.tonoRetryNow).toHaveBeenCalledTimes(1))
    expect(mocks.tonoConnect).toHaveBeenCalledTimes(1)
    expect(mocks.tonoDisconnect).not.toHaveBeenCalled()
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
        name: 'Not Connected — Click to connect',
      }),
    )
    await screen.findByRole('alert')

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

  it('keeps long action errors inside the narrow dashboard content area', async () => {
    mocks.status = makeStatus({ selectedServer: 'US West 1' })
    mocks.tonoConnect.mockRejectedValue(
      new Error(`TONO_SERVICE_BUSY: ${'unbroken-error-detail-'.repeat(20)}`),
    )
    renderDashboard()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Not Connected — Click to connect',
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
        name: 'Not Connected — Click to connect',
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
