// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import type { TonoStatus } from '@/services/tono'

import { SeaChrome } from './SeaChrome'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(cleanup)

it('uses four capsule links and two icon routes only when the appearance is on', () => {
  const renderChrome = (appearance: boolean) => (
    <MemoryRouter>
      <SeaChrome
        appearance={appearance}
        login={false}
        home
        status={undefined}
        sidebar={<aside>Existing sidebar</aside>}
        controls={null}
        onDoubleClick={vi.fn()}
      />
    </MemoryRouter>
  )
  const { rerender } = render(renderChrome(false))
  expect(screen.getByRole('complementary').textContent).toBe('Existing sidebar')
  rerender(renderChrome(true))
  expect(screen.queryByRole('complementary')).toBeNull()
  const navigation = screen.getByRole('navigation')
  expect(within(navigation).getAllByRole('link')).toHaveLength(4)
  expect(
    screen.getByRole('link', { name: 'tono.nav.nodes' }).getAttribute('href'),
  ).toBe('/servers')
  expect(
    screen.getByRole('link', { name: 'tono.nav.support' }).getAttribute('href'),
  ).toBe('/support')
  expect(
    screen
      .getByRole('link', { name: 'tono.nav.settings' })
      .getAttribute('href'),
  ).toBe('/settings')
})

it('links the evidence-correct state on other pages back to home', () => {
  render(
    <MemoryRouter initialEntries={['/servers']}>
      <SeaChrome
        appearance
        login={false}
        home={false}
        status={
          {
            uiState: 'connected',
            selectedServer: 'Tokyo 02',
            killSwitch: { wanted: true, live: false },
          } as TonoStatus
        }
        sidebar={null}
        controls={null}
        onDoubleClick={vi.fn()}
      />
    </MemoryRouter>,
  )
  expect(
    screen
      .getByRole('link', { name: 'tono.pill.title.protectionUnknown' })
      .getAttribute('href'),
  ).toBe('/')
  expect(
    screen
      .getByRole('link', { name: 'tono.pill.title.protectionUnknown' })
      .getAttribute('title'),
  ).toBe('Tokyo 02')
  expect(screen.queryByText('tono.pill.title.connected')).toBeNull()
})

it('keeps the state link named when the narrow bar hides its visible word', () => {
  const { container } = render(
    <MemoryRouter>
      <SeaChrome
        appearance
        login={false}
        home={false}
        status={undefined}
        sidebar={null}
        controls={null}
        onDoubleClick={vi.fn()}
      />
    </MemoryRouter>,
  )
  const word = container.querySelector<HTMLElement>('.tono-sea-state-word')
  if (!word) throw new Error('Missing state word')
  word.style.display = 'none'
  expect(
    screen
      .getByRole('link', { name: 'tono.home.title.idle' })
      .getAttribute('href'),
  ).toBe('/')
})
