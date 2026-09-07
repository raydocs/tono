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
  it('skips to login and records that the intro was seen', () => {
    renderIntro()
    expect(
      screen.getByRole('heading', { name: 'Connected means protected.' }),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(localStorage.getItem(TONO_INTRO_SEEN_KEY)).toBe('1')
    expect(screen.getByText('login page')).toBeDefined()
  })

  it('advances with ArrowRight and Enter, and skips with Escape', () => {
    renderIntro()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(
      screen.getByRole('heading', { name: 'Offline, never exposed.' }),
    ).toBeDefined()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(
      screen.getByRole('heading', { name: "Routes are Tono's job." }),
    ).toBeDefined()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(localStorage.getItem(TONO_INTRO_SEEN_KEY)).toBe('1')
    expect(screen.getByText('login page')).toBeDefined()
  })

  it('sets the seen flag and navigates from the final CTA', () => {
    renderIntro()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const start = screen.getByRole('button', { name: 'Get started →' })
    expect(document.activeElement).toBe(start)
    fireEvent.click(start)
    expect(localStorage.getItem(TONO_INTRO_SEEN_KEY)).toBe('1')
    expect(screen.getByText('login page')).toBeDefined()
  })
})
