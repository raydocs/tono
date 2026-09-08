// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: { uiState: 'protectedOffline' as string },
  mutateTonoStatus: vi.fn(),
  tonoRetryNow: vi.fn(),
  tonoDisconnect: vi.fn(),
}))

vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({
    status: mocks.status,
    mutateTonoStatus: mocks.mutateTonoStatus,
  }),
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))

vi.mock('@/services/tono', () => ({
  tonoRetryNow: mocks.tonoRetryNow,
  tonoDisconnect: mocks.tonoDisconnect,
  formatTonoActionError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { ProtectedOfflineBanner } from './ProtectedOfflineBanner'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ProtectedOfflineBanner />
    </MemoryRouter>,
  )

afterEach(cleanup)

describe('ProtectedOfflineBanner', () => {
  beforeEach(() => {
    mocks.status = { uiState: 'protectedOffline' }
  })

  it('is hidden on the dashboard route where the progress card already speaks this state', () => {
    renderAt('/')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is shown on other routes', () => {
    renderAt('/servers')
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText('tono.dashboard.status.offline')).toBeDefined()
  })

  it('is shown on activity', () => {
    renderAt('/activity')
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('says nothing when not protectedOffline', () => {
    mocks.status = { uiState: 'connected' }
    renderAt('/servers')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
