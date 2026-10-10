import { expect, it } from 'vitest'

import { publishSeaTraffic, readSeaTraffic } from './sea-traffic'

it('holds a steady rate on a log scale until the writer clears it', () => {
  publishSeaTraffic(2 * 1024 * 1024)
  const level = readSeaTraffic()
  expect(level).toBeGreaterThan(0.6)
  expect(level).toBeLessThan(0.9)
  expect(readSeaTraffic()).toBe(level)
  publishSeaTraffic(null)
  expect(readSeaTraffic()).toBe(0)
})
