// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SeaScene } from './SeaScene'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

it('freezes hidden phase transitions and resumes only live scene transitions', () => {
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const transition = {
    transitionProperty: 'transform',
    playState: 'running',
    pause: vi.fn(() => {
      transition.playState = 'paused'
    }),
    play: vi.fn(() => {
      transition.playState = 'running'
    }),
    cancel: vi.fn(() => {
      transition.playState = 'idle'
    }),
  }
  const replacement = {
    ...transition,
    pause: vi.fn(() => {
      replacement.playState = 'paused'
    }),
    play: vi.fn(() => {
      replacement.playState = 'running'
    }),
    cancel: vi.fn(() => {
      replacement.playState = 'idle'
    }),
  }
  const loop = { animationName: 'sea-wobble', pause: vi.fn(), play: vi.fn() }
  let animations = [transition, loop]
  const { container, rerender, unmount } = render(<SeaScene phase="idle" />)
  const scene = container.firstElementChild as HTMLElement
  scene.getAnimations = vi.fn(() => animations as unknown as Animation[])
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(transition.pause).toHaveBeenCalledOnce()
  expect(scene.getAnimations).toHaveBeenCalledWith({ subtree: true })
  expect(loop.pause).not.toHaveBeenCalled()

  // CSS cancels the old transition when a new phase arrives in the background.
  transition.playState = 'idle'
  animations = [replacement, loop]
  rerender(<SeaScene phase="connecting" />)
  expect(replacement.pause).toHaveBeenCalledOnce()
  visibility.mockReturnValue(false)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(transition.play).not.toHaveBeenCalled()
  expect(replacement.play).toHaveBeenCalledOnce()
  expect(loop.play).not.toHaveBeenCalled()

  visibility.mockReturnValue(true)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  unmount()
  expect(replacement.cancel).toHaveBeenCalledOnce()
})
