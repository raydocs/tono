// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { TonoStatus } from '@/services/tono'

import { SeaBackdrop } from './SeaBackdrop'

const native = vi.hoisted(() => ({
  status: { uiState: 'connecting' } as TonoStatus,
}))
vi.mock('@/hooks/use-tono', () => ({
  useTonoStatus: () => ({ status: native.status }),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps one scene across a route visit and applies an away phase without replaying sunrise', () => {
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const { container, rerender } = render(
    <SeaBackdrop enabled active>
      <span>Home</span>
    </SeaBackdrop>,
  )
  const scene = container.querySelector('.sea-scene')
  expect(scene?.getAttribute('data-phase')).toBe('connecting')
  rerender(
    <SeaBackdrop enabled active={false}>
      <span>Servers</span>
    </SeaBackdrop>,
  )
  native.status = {
    uiState: 'connected',
    killSwitch: { wanted: true, live: true },
  } as TonoStatus
  rerender(
    <SeaBackdrop enabled active={false}>
      <span>Servers</span>
    </SeaBackdrop>,
  )
  expect(scene?.getAttribute('data-phase')).toBe('connected')
  rerender(
    <SeaBackdrop enabled active>
      <span>Home</span>
    </SeaBackdrop>,
  )
  expect(container.querySelector('.sea-scene')).toBe(scene)
  expect(scene?.getAttribute('data-arrival')).toBe('false')
})
