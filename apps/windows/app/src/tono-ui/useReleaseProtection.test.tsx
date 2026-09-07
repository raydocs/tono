// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enShared from '@/locales/en/shared.json'
import enTono from '@/locales/en/tono.json'

const { tonoDisconnectMock } = vi.hoisted(() => ({
  tonoDisconnectMock: vi.fn(),
}))

vi.mock('@/services/tono', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tono')>()),
  tonoDisconnect: tonoDisconnectMock,
}))

vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))

import { useReleaseProtection } from './useReleaseProtection'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono, shared: enShared } } },
  lng: 'en',
})

const Harness = ({ mutate }: { mutate: () => Promise<unknown> }) => {
  const { requestRelease, dialog } = useReleaseProtection(mutate)
  return (
    <>
      <button type="button" onClick={requestRelease}>
        Open restore
      </button>
      {dialog}
    </>
  )
}

afterEach(() => cleanup())

beforeEach(() => {
  tonoDisconnectMock.mockReset().mockResolvedValue(undefined)
})

describe('useReleaseProtection', () => {
  it('does not disconnect until the confirm action is pressed', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined)
    render(<Harness mutate={mutate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open restore' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Restore normal internet',
    })
    expect(tonoDisconnectMock).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(tonoDisconnectMock).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disconnects, mutates status, and closes on confirm', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined)
    render(<Harness mutate={mutate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open restore' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Restore Normal Internet' }),
    )
    await waitFor(() => expect(tonoDisconnectMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the dialog open with the fallback error when disconnect fails', async () => {
    tonoDisconnectMock.mockRejectedValue(
      new Error('sc.exe start TonoService: os error 10061'),
    )
    const mutate = vi.fn()
    render(<Harness mutate={mutate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open restore' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Restore Normal Internet' }),
    )
    await screen.findByText(
      'Something went wrong. Details are below; copy them for support.',
    )
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(mutate).not.toHaveBeenCalled()
  })
})
