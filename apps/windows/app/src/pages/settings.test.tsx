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
import { SWRConfig } from 'swr'
import { afterEach, expect, it, vi } from 'vitest'

import enSettings from '@/locales/en/settings.json'
import enTono from '@/locales/en/tono.json'
import { setNewAppearance } from '@/tono-ui/appearance-preferences'

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('@/services/tono', async (original) => ({
  ...(await original<typeof import('@/services/tono')>()),
  tonoAuditEnabled: async () => true,
  tonoAuditLogPath: async () => ({ path: 'synthetic.log' }),
  tonoPeriodicTelemetryEnabled: async () => false,
  tonoInternalBuild: async () => false,
  tonoNetworkLogUploadEnabled: mocks.read,
  tonoSetNetworkLogUploadEnabled: mocks.write,
}))
vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))
vi.mock('@/components/setting/mods/update-viewer', () => ({
  UpdateViewer: () => null,
}))

import { PrivacyCard } from './settings'

afterEach(cleanup)

it('privacy choices wait for confirmation and recover failed reads or ambiguous saves by reloading', async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: { tono: enTono, settings: enSettings } } },
    lng: 'en',
  })
  setNewAppearance(true)
  let rejectRead!: (error: Error) => void
  mocks.read.mockReturnValueOnce(
    new Promise<boolean>((_, reject) => {
      rejectRead = reject
    }),
  )
  render(
    <SWRConfig
      value={{
        errorRetryCount: 0,
        dedupingInterval: 0,
        revalidateOnFocus: false,
      }}
    >
      <PrivacyCard />
    </SWRConfig>,
  )
  const toggle = screen.getByRole('switch', {
    name: 'Upload the full traffic log',
  }) as HTMLButtonElement
  expect(toggle.disabled).toBe(true)
  await waitFor(() =>
    expect(
      (
        screen.getByRole('switch', {
          name: 'Local diagnostic log',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  )
  expect(screen.getByRole('status').textContent).toBe('Reading saved choice…')
  await act(async () => rejectRead(new Error('Synthetic read failed')))
  expect((await screen.findByRole('alert')).textContent).toContain(
    "Couldn't read the saved choice.",
  )
  expect(toggle.disabled).toBe(true)

  mocks.read.mockResolvedValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved choice' }))
  await waitFor(() => expect(toggle.disabled).toBe(false))
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  let rejectSave!: (error: Error) => void
  mocks.write.mockReturnValueOnce(
    new Promise<void>((_, reject) => {
      rejectSave = reject
    }),
  )
  fireEvent.click(toggle)
  expect(toggle.disabled).toBe(true)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('status').textContent).toBe('Saving…')
  await act(async () => rejectSave(new Error('Synthetic lost reply')))
  expect(screen.getByRole('alert').textContent).toContain(
    "Couldn't confirm the change.",
  )
  expect(screen.getByText('Synthetic lost reply')).toBeDefined()
  expect(screen.getByText('Technical details').closest('details')?.open).toBe(
    false,
  )
  expect(screen.queryByText('Saved')).toBeNull()
  expect(toggle.disabled).toBe(true)

  // A lost reply can leave the actual saved value different from the old cache.
  mocks.read.mockResolvedValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved choice' }))
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  expect(screen.queryByRole('alert')).toBeNull()
  mocks.write.mockResolvedValue(undefined)
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
  expect(toggle.disabled).toBe(false)
  expect(screen.getByRole('status').textContent).toBe('Saved')
  expect(screen.getByText(/does not delete data already sent/)).toBeDefined()
})
