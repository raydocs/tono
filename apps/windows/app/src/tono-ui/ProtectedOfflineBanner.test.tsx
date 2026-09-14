// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: { uiState: 'protectedOffline' as string, selectedServer: null as string | null },
  mutateTonoStatus: vi.fn(),
  tonoRetryNow: vi.fn(),
  tonoDisconnect: vi.fn(),
  tonoServers: vi.fn(),
  tonoConnectProgress: vi.fn(),
  tonoSelectServer: vi.fn(),
}))

vi.mock('@/hooks/use-tono', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-tono')>()),
  useTonoStatus: () => ({
    status: mocks.status,
    mutateTonoStatus: mocks.mutateTonoStatus,
  }),
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'light' }))

vi.mock('@/services/tono', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tono')>()),
  tonoRetryNow: mocks.tonoRetryNow,
  tonoDisconnect: mocks.tonoDisconnect,
  tonoServers: mocks.tonoServers,
  tonoConnectProgress: mocks.tonoConnectProgress,
  tonoSelectServer: mocks.tonoSelectServer,
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
    mocks.status = { uiState: 'protectedOffline', selectedServer: null }
    mocks.tonoServers.mockReset().mockResolvedValue([])
    mocks.tonoConnectProgress.mockReset().mockResolvedValue({
      steps: [],
      totalElapsedMs: 0,
      failedStage: null,
      error: null,
      retryAttempt: 0,
      nextRetryAtMs: null,
    })
    mocks.tonoSelectServer.mockReset().mockResolvedValue(undefined)
    mocks.tonoRetryNow.mockReset().mockResolvedValue(undefined)
    mocks.tonoDisconnect.mockReset().mockResolvedValue(undefined)
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
    mocks.status = { uiState: 'connected', selectedServer: null }
    renderAt('/servers')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
