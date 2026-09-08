// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./design-tokens.css', () => ({}))
vi.mock('./tono.css', () => ({}))

import { handleTonoWindowShortcut } from './tono-layout'

const fire = (
  init: KeyboardEventInit,
  target: EventTarget | null = document.body,
) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  return { event, preventDefault }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('handleTonoWindowShortcut', () => {
  it('navigates Ctrl+1..4 even when an input is focused', () => {
    const navigate = vi.fn()
    const input = document.createElement('input')
    document.body.append(input)
    const routes = ['/', '/servers', '/activity', '/account'] as const
    for (const [index, path] of routes.entries()) {
      const { event, preventDefault } = fire(
        { key: String(index + 1), ctrlKey: true },
        input,
      )
      expect(
        handleTonoWindowShortcut(event, {
          navigate,
          uiState: 'notConnected',
          connect: vi.fn(),
          disconnect: vi.fn(),
        }),
      ).toBe(true)
      expect(preventDefault).toHaveBeenCalled()
      expect(navigate).toHaveBeenLastCalledWith(path)
    }
  })

  it('treats metaKey like ctrlKey for numbered routes', () => {
    const navigate = vi.fn()
    const { event } = fire({ key: '2', metaKey: true })
    handleTonoWindowShortcut(event, {
      navigate,
      uiState: 'connected',
      connect: vi.fn(),
      disconnect: vi.fn(),
    })
    expect(navigate).toHaveBeenCalledWith('/servers')
  })
})
