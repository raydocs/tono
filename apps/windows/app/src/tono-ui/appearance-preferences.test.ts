// @vitest-environment jsdom
import { expect, it } from 'vitest'

import {
  readAppearancePreferences,
  recordSceneProbe,
  setMotionPreference,
} from './appearance-preferences'

it('persists a downgrade without repeating it until Auto is explicitly rearmed', () => {
  localStorage.removeItem('tono-ui-preferences')
  try {
    expect(readAppearancePreferences().newAppearance).toBe(false)
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
