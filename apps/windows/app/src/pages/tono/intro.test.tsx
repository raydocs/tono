// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import enTono from '@/locales/en/tono.json'
import { TONO_INTRO_SEEN_KEY } from '@/pages/_layout/tono-guard'

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
  localStorage.removeItem(TONO_INTRO_SEEN_KEY)
})

afterEach(() => {
  cleanup()
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
