// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enTono from '@/locales/en/tono.json'
import { TONO_INTRO_SEEN_KEY } from '@/pages/_layout/tono-guard'
import { setNewAppearance } from '@/tono-ui/appearance-preferences'

vi.mock('@/tono-ui/SeaScene', () => ({
  SeaScene: ({ phase }: { phase: string }) => <div data-scene-phase={phase} />,
}))
import IntroPage from './intro'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: { tono: enTono } } },
  lng: 'en',
})

const renderIntro = () =>
  render(
    <MemoryRouter initialEntries={['/intro']}>
      <Routes>
        <Route path="/intro" element={<IntroPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  setNewAppearance(false)
  localStorage.removeItem(TONO_INTRO_SEEN_KEY)
})

afterEach(() => {
  cleanup()
  setNewAppearance(false)
  localStorage.removeItem(TONO_INTRO_SEEN_KEY)
})

describe('intro page', () => {
  it('shows every point on one screen and one focused primary that goes to sign-in', () => {
    renderIntro()
    expect(screen.getByText('Connected means protected.')).toBeDefined()
    expect(screen.getByText('Offline, never exposed.')).toBeDefined()
    expect(screen.getByText("Routes are Tono's job.")).toBeDefined()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(document.activeElement).toBe(buttons[0])

    fireEvent.click(screen.getByRole('button', { name: 'Get started →' }))
    expect(localStorage.getItem(TONO_INTRO_SEEN_KEY)).toBe('1')
    expect(screen.getByText('login page')).toBeDefined()
  })

  it('leaves for sign-in with Escape', () => {
    renderIntro()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(localStorage.getItem(TONO_INTRO_SEEN_KEY)).toBe('1')
    expect(screen.getByText('login page')).toBeDefined()
  })
})

it('teaches three scene phases then preserves the original sign-in destination and once-only marker', () => {
  setNewAppearance(true)
  renderIntro()
  expect(
    document
      .querySelector('[data-scene-phase]')
      ?.getAttribute('data-scene-phase'),
  ).toBe('connected')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(
    document
      .querySelector('[data-scene-phase]')
      ?.getAttribute('data-scene-phase'),
  ).toBe('failed')
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  expect(
    document
      .querySelector('[data-scene-phase]')
      ?.getAttribute('data-scene-phase'),
  ).toBe('idle')
  fireEvent.click(screen.getByRole('button', { name: 'Get started →' }))
  expect(localStorage.getItem(TONO_INTRO_SEEN_KEY)).toBe('1')
  expect(screen.getByText('login page')).toBeDefined()
})
