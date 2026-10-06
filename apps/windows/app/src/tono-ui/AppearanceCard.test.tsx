// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import enTono from '@/locales/en/tono.json'

import {
  readAppearancePreferences,
  setMotionPreference,
  setNewAppearance,
} from './appearance-preferences'
import { AppearanceCard } from './AppearanceCard'
import { SeaScene } from './SeaScene'

void i18n
  .use(initReactI18next)
  .init({ resources: { en: { translation: { tono: enTono } } }, lng: 'en' })
afterEach(() => {
  cleanup()
  setMotionPreference('auto')
  setNewAppearance(false)
  vi.unstubAllGlobals()
})
it('choosing Static stores the device preference and updates the real scene root', () => {
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  setNewAppearance(true)
  setMotionPreference('full')
  const { container } = render(
    <>
      <AppearanceCard />
      <SeaScene phase="idle" />
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Static' }))
  expect(readAppearancePreferences().motion).toBe('static')
  expect(
    JSON.parse(localStorage.getItem('tono-ui-preferences') ?? '{}').motion,
  ).toBe('static')
  expect(
    container.querySelector('.sea-scene')?.getAttribute('data-quality'),
  ).toBe('static')
})
