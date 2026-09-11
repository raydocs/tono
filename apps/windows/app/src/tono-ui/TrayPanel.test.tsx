// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  tonoConnectProgressQueryKey,
  tonoServersQueryKey,
} from '@/hooks/use-tono'
import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'
import { removeCacheData } from '@/services/query-client'
import type { TonoServer, TonoStatus } from '@/services/tono'

const mocks = vi.hoisted(() => ({
  status: undefined as TonoStatus | undefined,
  mutateTonoStatus: vi.fn(),
  tonoServers: vi.fn(),
  tonoConnectProgress: vi.fn(),
  tonoSelectServer: vi.fn(),
  tonoRetryNow: vi.fn(),
  tonoConnect: vi.fn(),
  tonoDisconnect: vi.fn(),
}))

vi.mock('@/hooks/use-tono', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-tono')>()),
  useTonoStatus: () => ({
    status: mocks.status,
    mutateTonoStatus: mocks.mutateTonoStatus,
  }),
}))

vi.mock('@/hooks/use-traffic-data', () => ({
  useTrafficData: () => ({
    response: { data: undefined },
    live: false,
    refreshGetClashTraffic: vi.fn(),
  }),
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('@/services/tono', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tono')>()),
  tonoServers: mocks.tonoServers,
  tonoConnectProgress: mocks.tonoConnectProgress,
  tonoSelectServer: mocks.tonoSelectServer,
  tonoRetryNow: mocks.tonoRetryNow,
  tonoConnect: mocks.tonoConnect,
  tonoDisconnect: mocks.tonoDisconnect,
}))

import { TrayPanel } from './TrayPanel'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})

const tokyo = 'Tokyo · Sakura'
const tokyoHy2 = 'Tokyo · Sakura · hy2'

const makeStatus = (overrides: Partial<TonoStatus> = {}): TonoStatus => ({
  accountState: 'ready',
  uiState: 'protectedOffline',
  stage: null,
  stageLabel: null,
  selectedServer: tokyo,
  protectionBlocked: true,
  killSwitch: null,
  catalogRevision: 1,
  catalogRequiresChoice: false,
  controllerGeneration: 1,
  ...overrides,
})

const catalogWithHy2 = (): TonoServer[] => [
  {
    name: tokyo,
    server: '203.0.113.10',
    port: 443,
    selected: true,
    available: true,
  },
  {
    name: tokyoHy2,
    server: '203.0.113.10',
    port: 443,
    selected: false,
    available: true,
  },
]

const freshSWR = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
)

beforeEach(() => {
  mocks.status = makeStatus()
  mocks.mutateTonoStatus.mockReset().mockResolvedValue(undefined)
  mocks.tonoServers.mockReset().mockResolvedValue(catalogWithHy2())
  mocks.tonoConnectProgress.mockReset().mockResolvedValue({
    steps: [],
    totalElapsedMs: 0,
    failedStage: 'checkingExit',
    error:
      'TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof [CORE_EXIT_UNREACHABLE]',
    retryAttempt: 1,
    nextRetryAtMs: null,
  })
  mocks.tonoSelectServer.mockReset().mockResolvedValue(undefined)
  mocks.tonoRetryNow.mockReset().mockResolvedValue(undefined)
  mocks.tonoConnect.mockReset().mockResolvedValue(undefined)
  mocks.tonoDisconnect.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
  cleanup()
  await removeCacheData(tonoConnectProgressQueryKey)
  await removeCacheData(tonoServersQueryKey)
})

describe('TrayPanel backup channel', () => {
  it('offers Try backup channel on handshake eof and only switches after a click', async () => {
    render(<TrayPanel />, { wrapper: freshSWR })

    expect(
      await screen.findByRole('button', { name: 'Try backup channel' }),
    ).toBeDefined()
    expect(mocks.tonoSelectServer).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('tono-tray-try-backup'))
    await waitFor(() =>
      expect(mocks.tonoSelectServer).toHaveBeenCalledWith(tokyoHy2),
    )
    await waitFor(() => expect(mocks.tonoRetryNow).toHaveBeenCalledTimes(1))
  })

  it('does not offer the backup channel for a DNS failure', async () => {
    mocks.tonoConnectProgress.mockResolvedValue({
      steps: [],
      totalElapsedMs: 0,
      failedStage: 'securingDNS',
      error: 'dns probe failed: exit refused',
      retryAttempt: 0,
      nextRetryAtMs: null,
    })

    render(<TrayPanel />, { wrapper: freshSWR })

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeDefined()
    expect(screen.queryByTestId('tono-tray-try-backup')).toBeNull()
  })

  it('still offers the backup channel when protected-offline has no failure record', async () => {
    mocks.tonoConnectProgress.mockResolvedValue({
      steps: [],
      totalElapsedMs: 0,
      failedStage: null,
      error: null,
      retryAttempt: 0,
      nextRetryAtMs: null,
    })

    render(<TrayPanel />, { wrapper: freshSWR })

    expect(
      await screen.findByRole('button', { name: 'Try backup channel' }),
    ).toBeDefined()
    expect(mocks.tonoSelectServer).not.toHaveBeenCalled()
  })
})
