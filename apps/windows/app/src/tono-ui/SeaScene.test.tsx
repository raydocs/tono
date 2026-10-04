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

it('keeps ambient motion when only glass transparency is unavailable', () => {
  vi.stubGlobal('CSS', { supports: () => false })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-transparency'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const { container } = render(<SeaScene phase="connecting" />)
  expect(container.firstElementChild?.getAttribute('data-motion')).toBe(
    'ambient',
  )
  expect(container.firstElementChild?.getAttribute('data-paused')).toBe('false')
})

it('arms arrival once only on a new connected phase without remounting scenery', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const { container, rerender } = render(<SeaScene phase="connected" />)
  const scene = container.firstElementChild
  expect(scene?.getAttribute('data-arrival')).toBe('false')
  rerender(<SeaScene phase="connecting" />)
  rerender(<SeaScene phase="connected" />)
  expect(scene?.getAttribute('data-arrival')).toBe('true')
  rerender(<SeaScene phase="connected" paused />)
  expect(container.firstElementChild).toBe(scene)
  expect(scene?.getAttribute('data-arrival')).toBe('false')
  rerender(<SeaScene phase="connected" />)
  expect(scene?.getAttribute('data-arrival')).toBe('false')
  rerender(<SeaScene phase="idle" />)
  expect(scene?.getAttribute('data-arrival')).toBe('false')
})

it('accepts bounded caller progress only while connecting and never advances it', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.useFakeTimers()
  try {
    const { container, rerender } = render(
      <SeaScene phase="connecting" progress={0} />,
    )
    const scene = container.firstElementChild as HTMLElement
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('205')
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('205')
    rerender(<SeaScene phase="connecting" progress={0.5} />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('130')
    rerender(<SeaScene phase="connecting" progress={1} />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('55')
    rerender(<SeaScene phase="connecting" progress={0.25} />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('167.5')
    rerender(<SeaScene phase="connecting" progress={-1} />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('205')
    rerender(<SeaScene phase="connecting" progress={2} />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('55')
    rerender(<SeaScene phase="idle" progress={1} />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('')
    expect(container.firstElementChild).toBe(scene)
    rerender(<SeaScene phase="connecting" />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('')
    rerender(<SeaScene phase="connecting" progress={Number.NaN} />)
    expect(scene.style.getPropertyValue('--sea-progress-offset')).toBe('')
  } finally {
    vi.useRealTimers()
  }
})

it('scales star density with the scene area without remounting the scene', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  let resize: ResizeObserverCallback | undefined
  const disconnect = vi.fn()
  const observe = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe = observe
      disconnect = disconnect
    },
  )
  const { container, unmount } = render(<SeaScene phase="idle" />)
  const scene = container.firstElementChild
  const smallCount = container.querySelectorAll('.sea-star').length
  expect(observe).toHaveBeenCalledWith(scene)
  act(() => {
    resize?.(
      [{ contentRect: { width: 1920, height: 1080 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    )
  })
  expect(container.firstElementChild).toBe(scene)
  expect(container.querySelectorAll('.sea-star').length).toBeGreaterThan(
    smallCount,
  )
  unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('keeps shared broken-light depth planes mounted across phases', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const { container, rerender } = render(<SeaScene phase="idle" />)
  const moonlight = container.querySelector('.sea-moon-path')
  const sunlight = container.querySelector('.sea-sun-path')
  const distant = moonlight?.querySelector('.sea-glints-far')
  const nearby = moonlight?.querySelector('.sea-glints-near')
  expect(moonlight?.querySelectorAll('.sea-specks')).toHaveLength(4)
  expect(sunlight?.querySelectorAll('.sea-specks')).toHaveLength(4)
  const solarDepth = sunlight?.querySelector('.sea-glints-far')
  expect(solarDepth).not.toBeNull()
  expect(distant).not.toBeNull()
  expect(nearby).not.toBeNull()
  expect(moonlight?.querySelector('.sea-bar')).toBeNull()
  expect(container.querySelector('.sea-moon-glow')?.classList).toContain(
    'sea-loop',
  )
  rerender(<SeaScene phase="connecting" progress={0.5} />)
  expect(container.querySelector('.sea-moon-path')).toBe(moonlight)
  expect(moonlight?.querySelector('.sea-glints-far')).toBe(distant)
  expect(moonlight?.querySelector('.sea-glints-near')).toBe(nearby)
  expect(container.querySelector('.sea-sun-path')).toBe(sunlight)
  expect(sunlight?.querySelector('.sea-glints-far')).toBe(solarDepth)
  rerender(<SeaScene phase="idle" paused />)
  expect(container.firstElementChild?.getAttribute('data-paused')).toBe('true')
  expect(container.querySelector('.sea-moon-path')).toBe(moonlight)
})
