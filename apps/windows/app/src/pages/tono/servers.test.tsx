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
import type { TonoRoutePreferences, TonoServer } from '@/services/tono'

const {
  serversMock,
  selectServerMock,
  connectMock,
  mutateTonoStatusMock,
  toastMock,
  uiStateMock,
  statusMock,
  scopeMock,
  preferencesMock,
  updatePreferencesMock,
  catalogStatusMock,
  testServersMock,
} = vi.hoisted(() => ({
  serversMock: vi.fn(),
  selectServerMock: vi.fn(),
  connectMock: vi.fn(),
  mutateTonoStatusMock: vi.fn(),
  toastMock: vi.fn(),
  uiStateMock: vi.fn(),
  statusMock: vi.fn(),
  scopeMock: vi.fn(),
  preferencesMock: vi.fn(),
  updatePreferencesMock: vi.fn(),
  catalogStatusMock: vi.fn(),
  testServersMock: vi.fn(),
}))
vi.mock('@/services/tono', async (original) => ({
  ...(await original<typeof import('@/services/tono')>()),
  tonoServers: serversMock,
  tonoSelectServer: selectServerMock,
  tonoConnect: connectMock,
  tonoStatus: statusMock,
  tonoRoutePreferences: preferencesMock,
  tonoUpdateRoutePreferences: updatePreferencesMock,
  tonoCatalogStatus: catalogStatusMock,
  tonoTestAvailableServers: testServersMock,
  tonoCancelServerTests: async () => {},
}))
vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))
vi.mock('@/hooks/use-tono', () => ({
  tonoServersQueryKey: ['tono', 'servers'],
  useTonoStatus: () => ({
    status: {
      uiState: uiStateMock(),
      accountState: 'ready',
      routePreferenceScope: scopeMock(),
      catalogRevision: 54,
    },
    mutateTonoStatus: mutateTonoStatusMock,
  }),
}))
vi.mock('@/tono-ui/tono-toast-context', () => ({
  useTonoToast: () => toastMock,
}))

import ServersPage from './servers'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})

beforeEach(() => {
  vi.clearAllMocks()
  selectServerMock.mockResolvedValue(undefined)
  connectMock.mockResolvedValue(undefined)
  mutateTonoStatusMock.mockResolvedValue(undefined)
  uiStateMock.mockReturnValue('notConnected')
  statusMock.mockImplementation(async () => ({ uiState: uiStateMock() }))
  scopeMock.mockReturnValue(undefined)
  preferencesMock.mockReset()
  updatePreferencesMock.mockReset()
  catalogStatusMock.mockResolvedValue({
    revision: null,
    nodeCount: 0,
    lastSyncedAtMs: null,
    error: null,
  })
  testServersMock.mockReset()
})
afterEach(cleanup)

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <ServersPage />
    </SWRConfig>,
  )

it('does not claim the node list is synced before the first catalog sync', async () => {
  serversMock.mockResolvedValue([])
  renderPage()
  expect(await screen.findByText('No servers available')).toBeDefined()
  expect(screen.queryByText('Node list synced')).toBeNull()
})

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

it('acknowledges a dispatched switch without claiming the new exit is connected', async () => {
  uiStateMock.mockReturnValue('connected')
  serversMock.mockResolvedValue([
    {
      name: 'Tokyo · Sakura',
      server: 'a.test',
      port: 443,
      selected: true,
      available: true,
    },
    {
      name: 'Los Angeles · Sunset',
      server: 'b.test',
      port: 443,
      selected: false,
      available: true,
    },
  ])
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Los Angeles/ }))
  await waitFor(() =>
    expect(toastMock).toHaveBeenCalledWith('Switch to Los Angeles requested'),
  )
  expect(selectServerMock).toHaveBeenCalledWith('Los Angeles · Sunset')
  expect(connectMock).not.toHaveBeenCalled()
})

it('does not turn an accepted switch into a failed connect using a stale idle render', async () => {
  let resume!: () => void
  selectServerMock.mockReturnValue(
    new Promise<void>((done) => {
      resume = done
    }),
  )
  connectMock.mockRejectedValue(new Error('already connected'))
  serversMock.mockResolvedValue([
    {
      name: 'Tokyo · Sakura',
      server: 'a.test',
      port: 443,
      selected: true,
      available: true,
    },
    {
      name: 'Los Angeles · Sunset',
      server: 'b.test',
      port: 443,
      selected: false,
      available: true,
    },
  ])
  renderPage() // The rendered snapshot is idle; a backend transition wins during selection.
  fireEvent.click(await screen.findByRole('button', { name: /Los Angeles/ }))
  statusMock.mockResolvedValue({ uiState: 'connected' })
  await act(async () => resume())
  await waitFor(() => expect(screen.queryByText('Connecting')).toBeNull())
  expect(connectMock).not.toHaveBeenCalled()
  expect(toastMock).toHaveBeenCalledWith('Switch to Los Angeles requested')
  expect(screen.queryByRole('alert')).toBeNull()
})

it('lets the user pick the hy2 sibling and labels it as the backup channel', async () => {
  serversMock.mockResolvedValue([
    {
      name: 'Tokyo · Sakura',
      server: '203.0.113.10',
      port: 443,
      selected: true,
      available: true,
    },
    {
      name: 'Tokyo · Sakura · hy2',
      server: '203.0.113.10',
      port: 443,
      selected: false,
      available: true,
    },
    {
      name: 'Los Angeles · Sunset · hy2',
      server: '198.51.100.10',
      port: 443,
      selected: false,
      available: true,
    },
    {
      name: 'Buffalo · Niagara · hy2',
      server: '198.51.100.11',
      port: 443,
      selected: false,
      available: true,
    },
  ])
  renderPage()
  expect((await screen.findAllByText('Backup UDP')).length).toBeGreaterThan(1)
  expect(
    screen.queryByRole('button', { name: /Tokyo · Sakura · Backup channel/ }),
  ).toBeNull()
  const sunset = await screen.findByRole('button', {
    name: /Los Angeles · Sunset · Backup channel/,
  })
  expect(sunset.textContent).toContain('Los Angeles · Sunset · Backup channel')
  expect(
    screen.getByRole('button', { name: /Buffalo · Niagara · Backup channel/ }),
  ).toBeDefined()
  fireEvent.click(sunset)
  await waitFor(() =>
    expect(selectServerMock).toHaveBeenCalledWith('Los Angeles · Sunset · hy2'),
  )
  await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))
})

it('connects when tapping the already selected city while disconnected', async () => {
  serversMock.mockResolvedValue([
    {
      name: 'Tokyo · Sakura',
      server: '203.0.113.10',
      port: 443,
      selected: true,
      available: true,
    },
    {
      name: 'Los Angeles · Sunset',
      server: '198.51.100.10',
      port: 443,
      selected: false,
      available: true,
    },
  ])
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Tokyo/ }))
  await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))
  expect(selectServerMock).not.toHaveBeenCalled()
})

const routeFixture = (): TonoRoutePreferences => ({
  scope: 'account-a:7',
  catalogRevision: 54,
  favorites: [],
  fixedRegion: null,
  recent: [],
})
const routeServers: TonoServer[] = [
  {
    name: 'Buffalo · Niagara',
    server: 'example.test',
    port: 443,
    selected: false,
    available: true,
  },
  {
    name: 'Buffalo · Niagara · hy2',
    server: 'example.test',
    port: 443,
    selected: false,
    available: true,
  },
]

it('ages batch TCP evidence from admission so a slow test cannot create a fresh recommendation', async () => {
  let clock = 1_790_000_000_000
  const time = vi.spyOn(Date, 'now').mockImplementation(() => clock)
  try {
    scopeMock.mockReturnValue('account-a:7')
    serversMock.mockResolvedValue(routeServers)
    preferencesMock.mockResolvedValue(routeFixture())
    catalogStatusMock.mockResolvedValue({ revision: 54, nodeCount: 2 })
    statusMock.mockResolvedValue({
      uiState: 'notConnected',
      routePreferenceScope: 'account-a:7',
      catalogRevision: 54,
    })
    let finish!: (results: { name: string; latencyMs: number }[]) => void
    testServersMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderPage()
    await screen.findByText('No verified successful connections yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Test All' }))
    await waitFor(() => expect(testServersMock).toHaveBeenCalledTimes(1))
    clock += 120_000
    await act(async () => finish([{ name: 'Buffalo · Niagara', latencyMs: 5 }]))
    expect(
      screen.queryByRole('button', { name: 'Select suggested route' }),
    ).toBeNull()
    expect(screen.getByText(/No fresh evidence for this region/)).toBeDefined()
    expect(connectMock).not.toHaveBeenCalled()
  } finally {
    time.mockRestore()
  }
})

it('stores a hy2 favorite under its shared node identity without selecting, connecting or inventing success', async () => {
  scopeMock.mockReturnValue('account-a:7')
  serversMock.mockResolvedValue(routeServers)
  let saved = routeFixture()
  preferencesMock.mockImplementation(async () => saved)
  updatePreferencesMock.mockImplementation(
    async (_scope, _revision, favorites, fixedRegion) => {
      saved = { ...saved, favorites, fixedRegion }
      return saved
    },
  )
  renderPage()
  const favorite = await screen.findByRole('button', {
    name: 'Save Buffalo · Niagara · Backup channel as a favorite',
  })
  const card = favorite.parentElement
  expect(card?.style.border).toContain('1px solid')
  expect(card?.closest('button')).toBeNull()
  expect(card?.querySelector('.tono-server-card')?.nextElementSibling).toBe(
    favorite,
  )
  fireEvent.click(favorite)
  await waitFor(() =>
    expect(updatePreferencesMock).toHaveBeenCalledWith(
      'account-a:7',
      54,
      ['Buffalo · Niagara'],
      null,
    ),
  )
  expect(
    await screen.findByRole('button', {
      name: 'Remove Buffalo from favorites',
    }),
  ).toBeDefined()
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Recommendation region' }),
    { target: { value: 'US' } },
  )
  await waitFor(() =>
    expect(updatePreferencesMock).toHaveBeenLastCalledWith(
      'account-a:7',
      54,
      ['Buffalo · Niagara'],
      'US',
    ),
  )
  expect(
    screen.getByText('No verified successful connections yet.'),
  ).toBeDefined()
  expect(selectServerMock).not.toHaveBeenCalled()
  expect(connectMock).not.toHaveBeenCalled()
})

it('only selects a recommendation on explicit confirmation and never connects or switches from the recommendation path', async () => {
  scopeMock.mockReturnValue('account-a:7')
  serversMock.mockResolvedValue(routeServers)
  preferencesMock.mockResolvedValue({
    ...routeFixture(),
    recent: [
      {
        name: 'Buffalo · Niagara',
        revision: 54,
        verifiedAtMs: Date.now() - 60_000,
      },
    ],
  })
  renderPage()
  const confirm = await screen.findByRole('button', {
    name: 'Select suggested route',
  })
  expect(selectServerMock).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(selectServerMock).toHaveBeenCalledWith('Buffalo · Niagara', {
      scope: 'account-a:7',
      catalogRevision: 54,
    }),
  )
  await waitFor(() =>
    expect(toastMock).toHaveBeenCalledWith(
      'Route selected. Use Connect when ready.',
    ),
  )
  expect(connectMock).not.toHaveBeenCalled()
  // The backend can become connected after render but before admission. A rejected idle fence
  // is not retried as an ordinary manual switch or Connect.
  selectServerMock.mockRejectedValueOnce(new Error('connection changed'))
  fireEvent.click(confirm)
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'The account, catalog or connection changed. Review the route before selecting again.',
  )
  expect(connectMock).not.toHaveBeenCalled()
  expect(selectServerMock).toHaveBeenCalledTimes(2)
})

it('does not show late account-A preferences as account-B history or recommendations', async () => {
  scopeMock.mockReturnValue('account-b:8')
  serversMock.mockResolvedValue(routeServers)
  let resolve!: (preferences: TonoRoutePreferences) => void
  preferencesMock.mockReturnValue(
    new Promise<TonoRoutePreferences>((done) => {
      resolve = done
    }),
  )
  renderPage()
  await waitFor(() => expect(preferencesMock).toHaveBeenCalled())
  await act(async () =>
    resolve({
      ...routeFixture(),
      favorites: ['Buffalo · Niagara'],
      recent: [
        {
          name: 'Buffalo · Niagara',
          revision: 54,
          verifiedAtMs: Date.now() - 1000,
        },
      ],
    }),
  )
  expect(
    screen.queryByRole('button', { name: 'Select suggested route' }),
  ).toBeNull()
  expect(screen.queryByText('Saved favorite')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain(
    'Waiting for this account’s route preferences…',
  )
  expect(
    screen.queryByText('No verified successful connections yet.'),
  ).toBeNull()
  expect(connectMock).not.toHaveBeenCalled()
})
