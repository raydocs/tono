// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'

vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))
vi.mock('@/hooks/use-tono', () => ({
  tonoAccountQueryKey: ['tonoAccount'],
  tonoDevicesQueryKey: ['tonoDevices'],
  tonoServersQueryKey: ['tonoServers'],
  useTonoStatus: () => ({ mutateTonoStatus: async () => {} }),
}))
vi.mock('@/services/tono', () => ({
  formatTonoActionError: (error: unknown) => String(error),
  tonoAccount: async () => ({
    email: 'a@example.test',
    suspended: false,
    deviceLimit: 3,
    plan: 'Pro',
    quotaBytes: 100 * 1024 ** 3,
    usageBytes: 12 * 1024 ** 3,
    expiresAt: Date.UTC(2026, 11, 31, 12) / 1000,
  }),
  tonoDevices: async () => [],
  tonoRevokeDevice: async () => {},
  tonoSignOut: async () => {},
}))

import { TonoAccountCard } from './TonoAccountCard'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
  interpolation: { escapeValue: false },
})

afterEach(() => cleanup())

describe('account card facts', () => {
  it('shows plan, expiry and data used against the quota', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter>
          <TonoAccountCard />
        </MemoryRouter>
      </SWRConfig>,
    )

    expect(await screen.findByText('Pro')).toBeDefined()
    expect(screen.getByText('2026-12-31')).toBeDefined()
    expect(screen.getByText('12.0 GB of 100 GB')).toBeDefined()
  })
})
