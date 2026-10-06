import { expect, it } from 'vitest'

import { SceneQualityProbe } from './scene-quality-probe'

it('downgrades using each tier samples and ends the total visible budget', () => {
  const probe = new SceneQualityProbe('full', true, 'Hardware')
  probe.frame(0)
  for (let time = 40; time <= 1520; time += 40) probe.frame(time)
  expect(probe.quality).toBe('lite')
  for (let time = 1580; time <= 3020; time += 60) probe.frame(time)
  expect(probe.quality).toBe('static')
  expect(probe.complete).toBe(true)
  const report = probe.report()
  probe.frame(9000)
  expect(probe.report()).toEqual(report)
  expect(report.liteP95).toBe(60)
})
it('excludes a hidden gap and starts software rendering in lite', () => {
  const probe = new SceneQualityProbe('full', true, 'ANGLE SwiftShader')
  expect(probe.quality).toBe('lite')
  probe.frame(0)
  probe.frame(16)
  probe.pause()
  probe.frame(10000)
  probe.frame(10016)
  expect(probe.report().visibleMs).toBe(32)
  expect(probe.report().samples).toBe(2)
  expect(probe.complete).toBe(false)
})
it('measures a manual full tier without automatically downgrading it', () => {
  const probe = new SceneQualityProbe('full', false, 'SwiftShader')
  probe.frame(0)
  for (let time = 100; time <= 3000; time += 100) probe.frame(time)
  expect(probe.quality).toBe('full')
  expect(probe.complete).toBe(true)
  expect(probe.report().visibleMs).toBe(3000)
})

it('includes late full-tier stalls in the final downgrade decision', () => {
  const probe = new SceneQualityProbe('full', true, 'Hardware')
  probe.frame(0)
  for (let time = 20; time <= 1500; time += 20) probe.frame(time)
  expect(probe.quality).toBe('full')
  for (let time = 1560; time <= 3000; time += 60) probe.frame(time)
  expect(probe.quality).toBe('lite')
  expect(probe.complete).toBe(true)
  expect(probe.report().liteP95).toBeNull()
})
