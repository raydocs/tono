// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { useTonoToast } from './tono-toast-context'
import { TonoToastProvider } from './TonoToast'

vi.mock('@/services/states', () => ({ useThemeMode: () => 'dark' }))
afterEach(cleanup)
const Trigger = () => {
  const show = useTonoToast()
  return (
    <button type="button" onClick={() => show('Action failed', 'error')}>
      Show
    </button>
  )
}
it('carries the requested error kind without changing the message channel', () => {
  render(
    <TonoToastProvider>
      <Trigger />
    </TonoToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show' }))
  const toast = screen.getByRole('status')
  expect(toast.textContent).toBe('Action failed')
  expect(toast.getAttribute('data-kind')).toBe('error')
})
