// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import IntroPage from '@/pages/tono/intro'
import { getTonoPreferences } from '@/services/cmds'

import { preloadAppData } from './preload'

vi.mock('@/services/cmds', () => ({ getTonoPreferences: vi.fn() }))
vi.mock('@/tono-ui/SeaScene', () => ({ SeaScene: () => null }))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

it('renders Chinese on first launch even on an English OS, preserving saved English and falling back for unknown or missing locales', async () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  const preferences = vi.mocked(getTonoPreferences)
  const show = () =>
    render(
      <MemoryRouter>
        <IntroPage />
      </MemoryRouter>,
    )

  preferences.mockResolvedValueOnce({})
  expect((await preloadAppData()).initialLanguage).toBe('zh')
  show()
  expect(
    screen.getByRole('heading', { name: '连上，就受保护。' }),
  ).toBeDefined()
  expect(screen.queryByText('Connected means protected.')).toBeNull()
  expect(document.documentElement.lang).toBe('zh-CN')
  cleanup()

  localStorage.clear()
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
  preferences.mockResolvedValueOnce({ language: 'en' })
  expect((await preloadAppData()).initialLanguage).toBe('en')
  show()
  expect(
    screen.getByRole('heading', { name: 'Connected means protected.' }),
  ).toBeDefined()
  expect(document.documentElement.lang).toBe('en')
  cleanup()
  // A later startup still respects the persisted web choice when native IO is unavailable.
  preferences.mockRejectedValueOnce(
    new Error('Synthetic unavailable preferences'),
  )
  expect((await preloadAppData()).initialLanguage).toBe('en')

  localStorage.clear()
  preferences.mockResolvedValueOnce({ language: 'unknown-locale' })
  expect((await preloadAppData()).initialLanguage).toBe('zh')
  show()
  expect(
    screen.getByRole('heading', { name: '连上，就受保护。' }),
  ).toBeDefined()
  cleanup()

  localStorage.clear()
  preferences.mockRejectedValueOnce(new Error('Synthetic missing preferences'))
  expect((await preloadAppData()).initialLanguage).toBe('zh')
  show()
  expect(
    screen.getByRole('heading', { name: '连上，就受保护。' }),
  ).toBeDefined()
})

it('restores saved native English after an unavailable boot cached the Chinese fallback', async () => {
  const preferences = vi.mocked(getTonoPreferences)
  preferences.mockRejectedValueOnce(new Error('Synthetic unavailable IPC'))
  expect((await preloadAppData()).initialLanguage).toBe('zh')
  expect(localStorage.getItem('tono-language')).toBe('zh')

  preferences.mockResolvedValueOnce({ language: 'en' })
  expect((await preloadAppData()).initialLanguage).toBe('en')
  expect(localStorage.getItem('tono-language')).toBe('en')
  render(
    <MemoryRouter>
      <IntroPage />
    </MemoryRouter>,
  )
  expect(
    screen.getByRole('heading', { name: 'Connected means protected.' }),
  ).toBeDefined()
  expect(screen.queryByText('连上，就受保护。')).toBeNull()
  expect(document.documentElement.lang).toBe('en')
})
