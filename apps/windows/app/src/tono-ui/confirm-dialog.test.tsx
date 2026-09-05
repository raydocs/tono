// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))

import { TonoConfirmDialog } from './TonoAccountCard'

const props = {
  dark: true,
  title: 'Restore normal internet?',
  message: 'Traffic will no longer be protected.',
  confirmLabel: 'Restore',
  cancelLabel: 'Cancel',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

afterEach(() => cleanup())

describe('confirmation keyboard safety', () => {
  it('focuses the safe action and restores the opener on close', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<TonoConfirmDialog {...props} />)
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel' }),
    )
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('wraps Tab and Shift+Tab instead of reaching background actions', () => {
    render(<TonoConfirmDialog {...props} />)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Restore' })
    confirm.focus()
    expect(fireEvent.keyDown(confirm, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(cancel)
    expect(fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })).toBe(
      false,
    )
    expect(document.activeElement).toBe(confirm)
  })

  it('preserves chosen focus on rerender and uses the latest cancel callback', () => {
    const oldCancel = vi.fn()
    const newCancel = vi.fn()
    const { rerender } = render(
      <TonoConfirmDialog {...props} onCancel={oldCancel} />,
    )
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    rerender(
      <TonoConfirmDialog {...props} error="Try again" onCancel={newCancel} />,
    )
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Escape' })
    expect(newCancel).toHaveBeenCalledOnce()
    expect(oldCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Try again')
  })
})
