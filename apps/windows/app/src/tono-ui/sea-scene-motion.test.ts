import { expect, it } from 'vitest'

import { seaSceneMotion } from './sea-scene-motion'

it('throttles the scene behind an inner page instead of holding it, and holds it only when hidden', () => {
  expect(
    seaSceneMotion({ hidden: false, unfocused: false, blurred: true }),
  ).toBe('throttled')
  expect(
    seaSceneMotion({ hidden: false, unfocused: false, blurred: false }),
  ).toBe('live')
  expect(seaSceneMotion({ hidden: true, unfocused: true, blurred: true })).toBe(
    'held',
  )
})
