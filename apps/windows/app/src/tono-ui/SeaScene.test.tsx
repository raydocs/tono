// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SeaScene } from './SeaScene'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps its phase DOM and follows reduced-motion and visibility changes', () => {
  let reduced = false
  const change = new EventTarget()
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('reduced-motion') && reduced
    },
    addEventListener: change.addEventListener.bind(change),
    removeEventListener: change.removeEventListener.bind(change),
  }))
  const { container, rerender, unmount } = render(
    <SeaScene phase="connected" />,
  )
  const scene = container.firstElementChild
  expect(scene?.getAttribute('data-phase')).toBe('connected')
  expect(scene?.getAttribute('aria-hidden')).toBe('true')
  expect(scene?.getAttribute('data-motion')).toBe('ambient')

  act(() => {
    reduced = true
    change.dispatchEvent(new Event('change'))
  })
  rerender(<SeaScene phase="idle" />)
  expect(container.firstElementChild).toBe(scene)
  expect(scene?.getAttribute('data-phase')).toBe('idle')
  expect(scene?.getAttribute('data-motion')).toBe('static')
  expect(scene?.getAttribute('data-paused')).toBe('true')

  act(() => {
    reduced = false
    change.dispatchEvent(new Event('change'))
  })
  rerender(<SeaScene phase="connecting" paused />)
  expect(scene?.getAttribute('data-phase')).toBe('connecting')
  expect(scene?.getAttribute('data-motion')).toBe('static')
  rerender(<SeaScene phase="failed" />)
  expect(scene?.getAttribute('data-motion')).toBe('ambient')
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(scene?.getAttribute('data-paused')).toBe('true')
  visibility.mockRestore()
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(scene?.getAttribute('data-paused')).toBe('false')
  unmount()
  act(() => {
    change.dispatchEvent(new Event('change'))
  })
})
