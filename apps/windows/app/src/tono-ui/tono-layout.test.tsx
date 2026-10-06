// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./design-tokens.css', () => ({}))
vi.mock('./tono.css', () => ({}))

import {
  applyWindowFrame,
  connectFromShortcut,
  handleTonoWindowShortcut,
} from './tono-layout'

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

it('leaves Ctrl+K to an open confirmation instead of connecting or disconnecting behind it', () => {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  document.body.append(dialog)
  const connect = vi.fn()
  const disconnect = vi.fn()
  for (const uiState of ['connected', 'notConnected'])
    handleTonoWindowShortcut(fire({ key: 'k', ctrlKey: true }).event, {
      navigate: vi.fn(),
      uiState,
      connect,
      disconnect,
    })
  expect(connect).not.toHaveBeenCalled()
  expect(disconnect).not.toHaveBeenCalled()
})

describe('connectFromShortcut', () => {
  it('opens the server picker when Ctrl+K connect is refused for no server', async () => {
    const navigate = vi.fn()
    await connectFromShortcut(
      () => Promise.reject(new Error('select a server first')),
      navigate,
    )
    expect(navigate).toHaveBeenCalledWith('/servers')
  })
})

describe('applyWindowFrame', () => {
  it('gives the old look its frame back when the window was restored frameless', async () => {
    const target = {
      isDecorated: vi.fn().mockResolvedValue(false),
      setDecorations: vi.fn().mockResolvedValue(undefined),
    }
    expect(await applyWindowFrame(target, false)).toBe(true)
    expect(target.setDecorations).toHaveBeenCalledWith(true)
  })
})
