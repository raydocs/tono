// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  scope: 'process:account-a-generation' as string | null,
}))

vi.mock('@/hooks/use-tono', () => ({
  tonoAccountQueryKey: ['tonoAccount'],
  useTonoStatus: () => ({ status: { routePreferenceScope: mocks.scope } }),
}))
vi.mock('@/services/tono', () => ({ tonoAccount: mocks.account }))
vi.mock('@/hooks/use-connection-data', () => ({
  useConnectionData: () => ({
    response: { data: { activeConnections: [], closedConnections: [] } },
  }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('./GlassCard', () => ({
  GlassCard: ({ children }: { children: ReactNode }) => children,
}))

import { aiTrafficStorageKey } from './ai-traffic'
import { AiTrafficCard } from './AiTrafficCard'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('hides the previous account tally while replacement sign-in is pending', async () => {
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>(
    'node:crypto',
  )
  vi.stubGlobal('crypto', webcrypto)
  const key = await aiTrafficStorageKey('account-a@example.test')
  const history = JSON.stringify({
    [dayjs().format('YYYY-MM-DD')]: { Claude: 123_456 },
  })
  localStorage.setItem(key, history)
  const replacementKey = await aiTrafficStorageKey('account-b@example.test')
  localStorage.setItem(
    replacementKey,
    JSON.stringify({
      [dayjs().format('YYYY-MM-DD')]: { Grok: 4_567 },
    }),
  )
  mocks.account.mockResolvedValue({ email: 'account-a@example.test' })
  const cache = new Map()
  const value = {
    provider: () => cache,
    dedupingInterval: 0,
    errorRetryCount: 0,
  }
  const view = (visible: boolean) => (
    <SWRConfig value={value}>
      {visible && <AiTrafficCard connected={false} generation={1} />}
    </SWRConfig>
  )
  const { rerender } = render(view(true))
  await screen.findByText('Claude')

  // Replacement sign-in does not run the Account card's explicit sign-out
  // cache clearing. Keep real SWR mounted while the auth guard drops the card.
  rerender(view(false))
  mocks.scope = 'process:account-b-generation'
  let resolveReplacement!: (account: { email: string }) => void
  mocks.account.mockReturnValue(
    new Promise((resolve) => {
      resolveReplacement = resolve
    }),
  )
  rerender(view(true))
  await act(async () => {
    await Promise.resolve()
  })
  expect(screen.queryByText('Claude')).toBeNull()
  expect(mocks.account).toHaveBeenCalledTimes(2)
  await act(async () => {
    resolveReplacement({ email: 'account-b@example.test' })
  })
  await screen.findByText('Grok')
  expect(screen.queryByText('Claude')).toBeNull()

  // No ready owner must also disable account reads without deleting A's
  // retained local history.
  mocks.scope = null
  rerender(view(true))
  expect(screen.queryByText('Claude')).toBeNull()
  expect(screen.queryByText('Grok')).toBeNull()
  expect(mocks.account).toHaveBeenCalledTimes(2)
  expect(localStorage.getItem(key)).toBe(history)
})
