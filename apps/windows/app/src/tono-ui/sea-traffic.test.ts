import { expect, it } from 'vitest'

import { publishSeaTraffic, readSeaTraffic } from './sea-traffic'

it('reads live throughput on a log scale and calms when the writer stops', () => {
  publishSeaTraffic(2 * 1024 * 1024, 1000)
  const level = readSeaTraffic(1500)
  expect(level).toBeGreaterThan(0.6)
  expect(level).toBeLessThan(0.9)
  expect(readSeaTraffic(1000 + 4001)).toBe(0)
  publishSeaTraffic(null, 6000)
  expect(readSeaTraffic(6000)).toBe(0)
})
