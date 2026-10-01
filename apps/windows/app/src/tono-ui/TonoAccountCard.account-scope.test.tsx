// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: {
    accountState: 'ready',
    routePreferenceScope: 'process:account-a-generation',
  } as { accountState: string; routePreferenceScope: string | null },
  account: vi.fn(),
  devices: vi.fn(),
}))

vi.mock('@/hooks/use-tono', () => ({
  tonoAccountQueryKey: ['tonoAccount'],
  tonoDevicesQueryKey: ['tonoDevices'],
  tonoServersQueryKey: ['tonoServers'],
  useTonoStatus: () => ({
    status: mocks.status,
    mutateTonoStatus: vi.fn(),
  }),
}))
vi.mock('@/services/tono', () => ({
  tonoAccount: mocks.account,
  tonoDevices: mocks.devices,
  tonoRevokeDevice: vi.fn(),
  tonoSignOut: vi.fn(),
  formatTonoActionError: String,
}))
vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('./GlassCard', () => ({
  GlassCard: ({ children }: { children: ReactNode }) => children,
}))

import { TonoAccountCard } from './TonoAccountCard'

afterEach(cleanup)

it('does not display the previous account devices after replacement sign-in', async () => {
  mocks.account.mockResolvedValue({
    email: 'account-a@example.test',
    suspended: false,
    deviceLimit: 5,
  })
  mocks.devices.mockResolvedValue([
    { id: 'device-a', name: 'Account-A-private-laptop', current: false },
  ])
  const cache = new Map()
  const value = {
    provider: () => cache,
    dedupingInterval: 0,
    errorRetryCount: 0,
  }
  const view = (showCard: boolean) => (
    <SWRConfig value={value}>{showCard && <TonoAccountCard />}</SWRConfig>
  )
  const { rerender } = render(view(true))
  await screen.findByText('account-a@example.test')
  await screen.findByText('Account-A-private-laptop')

  // The auth guard unmounts Account when A becomes Suspended. "Use another email"
  // then adopts B without executing the explicit sign-out cache-clearing path.
  mocks.status = { accountState: 'suspended', routePreferenceScope: null }
  rerender(view(false))
  mocks.status = {
    accountState: 'ready',
    routePreferenceScope: 'process:account-b-generation',
  }
  mocks.account.mockResolvedValue({
    email: 'account-b@example.test',
    suspended: false,
    deviceLimit: 5,
  })
  let rejectDevices!: (error: Error) => void
  mocks.devices.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectDevices = reject
    }),
  )
  rerender(view(true))
  await screen.findByText('account-b@example.test')

  expect(screen.queryByText('Account-A-private-laptop')).toBeNull()
  await act(async () =>
    rejectDevices(new Error('B device endpoint unavailable')),
  )
  expect(screen.queryByText('Account-A-private-laptop')).toBeNull()
})
