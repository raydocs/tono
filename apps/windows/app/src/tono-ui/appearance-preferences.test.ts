// @vitest-environment jsdom
import { expect, it } from 'vitest'

import {
  readAppearancePreferences,
  recordSceneProbe,
  setMotionPreference,
  setNewAppearance,
} from './appearance-preferences'

it('persists a downgrade without repeating it until Auto is explicitly rearmed', () => {
  localStorage.removeItem('tono-ui-preferences')
  try {
    expect(readAppearancePreferences().newAppearance).toBe(true)
    setMotionPreference('auto')
    const revision = readAppearancePreferences().revision
    const report = {
      fps: 25,
      p95: 40,
      liteP95: 40,
      visibleMs: 3000,
      samples: 75,
      renderer: 'Hardware',
    }
    recordSceneProbe(revision, 'lite', report, true)
    expect(readAppearancePreferences().automaticQuality).toBe('lite')
    expect(readAppearancePreferences().measured).toBe(true)
    recordSceneProbe(revision, 'full', report, true)
    expect(readAppearancePreferences().automaticQuality).toBe('lite')
    expect(
      JSON.parse(localStorage.getItem('tono-ui-preferences') ?? '{}').measured,
    ).toBe(true)
    setMotionPreference('full')
    expect(readAppearancePreferences().automaticQuality).toBe('lite')
    setMotionPreference('auto')
    expect(readAppearancePreferences().automaticQuality).toBe('full')
    expect(readAppearancePreferences().measured).toBe(false)
    expect(readAppearancePreferences().report).toBeNull()
  } finally {
    localStorage.removeItem('tono-ui-preferences')
  }
})

it('gives every install the new appearance, whatever an earlier build stored', () => {
  localStorage.clear()
  expect(readAppearancePreferences().newAppearance).toBe(true)
  localStorage.setItem(
    'tono-ui-preferences',
    JSON.stringify({ newAppearance: false }),
  )
  expect(readAppearancePreferences().newAppearance).toBe(true)
  localStorage.clear()
})

it('takes the first-frame flag off the document when the appearance is turned off', () => {
  document.documentElement.dataset.seaAppearance = 'true'
  setNewAppearance(false)
  expect(document.documentElement.dataset.seaAppearance).toBeUndefined()
  setNewAppearance(true)
  expect(document.documentElement.dataset.seaAppearance).toBe('true')
})
