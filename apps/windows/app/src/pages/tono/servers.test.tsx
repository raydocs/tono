// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SWRConfig, unstable_serialize } from 'swr'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'
import type { TonoServer } from '@/services/tono'

const { serversMock, selectServerMock, mutateTonoStatusMock } = vi.hoisted(
  () => ({
    serversMock: vi.fn(),
    selectServerMock: vi.fn(),
    mutateTonoStatusMock: vi.fn(),
  }),
)
vi.mock('@/services/tono', async (original) => ({
  ...(await original<typeof import('@/services/tono')>()),
  tonoServers: serversMock,
  tonoSelectServer: selectServerMock,
  tonoCatalogStatus: async () => ({
    revision: null,
    nodeCount: 0,
    lastSyncedAtMs: null,
    error: null,
  }),
  tonoCancelServerTests: async () => {},
}))
vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))
vi.mock('@/hooks/use-tono', () => ({
  tonoServersQueryKey: ['tono', 'servers'],
  useTonoStatus: () => ({
    status: { uiState: 'notConnected', accountState: 'ready' },
    mutateTonoStatus: mutateTonoStatusMock,
  }),
}))
vi.mock('@/tono-ui/tono-toast-context', () => ({ useTonoToast: () => vi.fn() }))

import ServersPage from './servers'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})

beforeEach(() => {
  vi.clearAllMocks()
  selectServerMock.mockResolvedValue(undefined)
  mutateTonoStatusMock.mockResolvedValue(undefined)
})
afterEach(cleanup)

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <ServersPage />
    </SWRConfig>,
  )

it('does not claim an empty list while the first server read is pending', async () => {
  let resolve!: (servers: TonoServer[]) => void
  serversMock.mockReturnValue(
    new Promise<TonoServer[]>((done) => {
      resolve = done
    }),
  )
  renderPage()
  expect(screen.queryByText('No servers available')).toBeNull()
  const status = screen.getByRole('status')
  expect(status.getAttribute('aria-busy')).toBe('true')
  expect(status.getAttribute('aria-label')).toBe('Loading...')
  expect(status.querySelectorAll('.tono-server-skeleton')).toHaveLength(4)
  await act(async () => resolve([]))
  expect(await screen.findByText('No servers available')).toBeDefined()
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows a failed read, handles a failed retry, and recovers on retry', async () => {
  serversMock.mockRejectedValue(new Error('Server list unavailable'))
  renderPage()
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Something went wrong',
  )
  expect(screen.queryByText('No servers available')).toBeNull()
  let reject!: (error: Error) => void
  serversMock.mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    (screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  await act(async () => reject(new Error('Still unavailable')))
  expect(await screen.findByText(/Something went wrong/)).toBeDefined()
  serversMock.mockResolvedValue([
    {
      name: 'US West 1',
      server: 'example.test',
      port: 443,
      selected: false,
      available: true,
    },
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: /US West 1/ })).toBeDefined()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText('No servers available')).toBeNull()
})

it('keeps cached servers visible when revalidation fails', async () => {
  serversMock.mockRejectedValue(new Error('Server list unavailable'))
  render(
    <SWRConfig
      value={{
        provider: () =>
          new Map([
            [
              unstable_serialize(['tono', 'servers']),
              {
                data: [
                  {
                    name: 'US West 1',
                    server: 'example.test',
                    port: 443,
                    selected: false,
                    available: true,
                  },
                ],
              },
            ],
          ]),
        errorRetryCount: 0,
      }}
    >
      <ServersPage />
    </SWRConfig>,
  )
  expect(await screen.findByRole('alert')).toBeDefined()
  expect(screen.getByRole('button', { name: /US West 1/ })).toBeDefined()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByText('No servers available')).toBeNull()
})

it('shows an in-flight spinner on the chosen card and disables the others until select resolves', async () => {
  let resolveSelect!: () => void
  selectServerMock.mockReturnValue(
    new Promise<void>((done) => {
      resolveSelect = done
    }),
  )
  serversMock.mockResolvedValue([
    {
      name: 'US West 1',
      server: 'a.test',
      port: 443,
      selected: false,
      available: true,
    },
    {
      name: 'JP East 1',
      server: 'b.test',
      port: 443,
      selected: true,
      available: true,
    },
  ])
  renderPage()
  const west = await screen.findByRole('button', { name: /US West 1/ })
  const east = screen.getByRole('button', { name: /JP East 1/ })
  fireEvent.click(west)
  expect(await screen.findByText('Connecting')).toBeDefined()
  expect(west.querySelector('.tono-spin')).toBeTruthy()
  expect((east as HTMLButtonElement).disabled).toBe(true)
  expect((west as HTMLButtonElement).disabled).toBe(false)
  await act(async () => resolveSelect())
  await waitFor(() => {
    expect(screen.queryByText('Connecting')).toBeNull()
    expect((east as HTMLButtonElement).disabled).toBe(false)
  })
})
