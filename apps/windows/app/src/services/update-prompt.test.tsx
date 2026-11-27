// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))

import {
  OPEN_UPDATE_STORAGE_KEY,
  OPEN_UPDATE_WINDOW_EVENT,
  SHOW_UPDATE_EVENT,
  UpdatePromptListener,
} from './update-prompt'

beforeEach(() => {
  sessionStorage.clear()
  mocks.invoke.mockReset().mockResolvedValue(false)
  mocks.unlisten.mockReset()
  mocks.listen.mockReset().mockResolvedValue(mocks.unlisten)
})

afterEach(cleanup)

describe('UpdatePromptListener', () => {
  it('consumes a cold-start pending update prompt once on mount', async () => {
    mocks.invoke.mockResolvedValueOnce(true)
    const onOpen = vi.fn()
    window.addEventListener(OPEN_UPDATE_WINDOW_EVENT, onOpen)
    try {
      render(<UpdatePromptListener />)
      await waitFor(() =>
        expect(mocks.invoke).toHaveBeenCalledWith('take_pending_update_prompt'),
      )
      await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
      expect(sessionStorage.getItem(OPEN_UPDATE_STORAGE_KEY)).toBe('1')
    } finally {
      window.removeEventListener(OPEN_UPDATE_WINDOW_EVENT, onOpen)
    }
  })

  it('opens the update viewer and clears the pending flag when notified live', async () => {
    let listener!: () => void
    mocks.listen.mockImplementationOnce(
      async (_event: string, cb: () => void) => {
        listener = cb
        return mocks.unlisten
      },
    )
    const onOpen = vi.fn()
    window.addEventListener(OPEN_UPDATE_WINDOW_EVENT, onOpen)
    try {
      const { unmount } = render(<UpdatePromptListener />)
      await waitFor(() =>
        expect(mocks.listen).toHaveBeenCalledWith(
          SHOW_UPDATE_EVENT,
          expect.any(Function),
        ),
      )
      expect(onOpen).not.toHaveBeenCalled()

      listener()
      expect(onOpen).toHaveBeenCalledTimes(1)
      expect(mocks.invoke).toHaveBeenCalledWith('take_pending_update_prompt')
      expect(sessionStorage.getItem(OPEN_UPDATE_STORAGE_KEY)).toBe('1')

      unmount()
      expect(mocks.unlisten).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener(OPEN_UPDATE_WINDOW_EVENT, onOpen)
    }
  })
})
