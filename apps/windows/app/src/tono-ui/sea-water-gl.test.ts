// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

import { seaWaterClock, startSeaWater } from './sea-water-gl'

afterEach(() => {
  vi.restoreAllMocks()
})

it('keeps the wave phases bounded after days of uptime without moving the waves', () => {
  const threeDays = 3 * 86400 + 0.37
  const clock = seaWaterClock(threeDays)
  const speed = Math.sqrt((9.81 * 6.2832) / 15) * 0.8
  for (const phase of clock.waves) {
    expect(Math.abs(phase)).toBeLessThan(2 * Math.PI)
  }
  // Wrapped on its own period: the same wave as the unwrapped phase.
  expect(Math.cos(clock.waves[0] ?? 0)).toBeCloseTo(
    Math.cos(speed * threeDays),
    9,
  )
  expect(Math.abs(clock.drift[0])).toBeLessThan(256)
  expect(clock.dither).toBeCloseTo(0.37, 9)
})

it('releases its GL objects and context on dispose and rebuilds after a context restore', () => {
  const lose = { loseContext: vi.fn(), restoreContext: vi.fn() }
  const calls: Record<string, ReturnType<typeof vi.fn>> = {}
  const gl = new Proxy(
    {
      getExtension: () => lose,
      isContextLost: () => false,
      getShaderParameter: () => true,
      getProgramParameter: () => true,
    } as Record<string | symbol, unknown>,
    {
      get(target, key) {
        if (key in target) return target[key]
        if (typeof key === 'string' && /^[A-Z_]+$/.test(key)) return 1
        if (typeof key !== 'string') return undefined
        calls[key] ??= vi.fn(() => ({ name: key }))
        return calls[key]
      },
    },
  )
  const scene = document.createElement('div')
  scene.innerHTML =
    '<div class="sea-track"><div class="sea-sun-body"></div></div><div class="sea-water"><canvas></canvas></div>'
  const canvas = scene.querySelector('canvas') as HTMLCanvasElement
  canvas.getContext = vi.fn(() => gl) as unknown as typeof canvas.getContext

  const renderer = startSeaWater(scene, canvas)
  expect(renderer).not.toBeNull()
  expect(calls.createProgram).toHaveBeenCalledTimes(1)

  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
  canvas.dispatchEvent(new Event('webglcontextrestored'))
  expect(calls.createProgram).toHaveBeenCalledTimes(2)

  renderer?.dispose()
  expect(calls.deleteProgram).toHaveBeenCalledTimes(1)
  expect(calls.deleteBuffer).toHaveBeenCalledTimes(1)
  expect(calls.deleteShader).toHaveBeenCalledTimes(2)
  expect(lose.loseContext).toHaveBeenCalledOnce()
})
