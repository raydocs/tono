// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SeaTabs, SeaToggle } from './SeaControls'

afterEach(cleanup)
it('supports arrow-key tab selection and moves focus to the chosen tab', () => {
  const change = vi.fn()
  render(
    <SeaTabs
      label="Routes"
      value="all"
      onChange={change}
      options={[
        { value: 'all', label: 'All' },
        { value: 'exit', label: 'Servers' },
      ]}
    />,
  )
  fireEvent.keyDown(screen.getByRole('tab', { name: 'All' }), {
    key: 'ArrowRight',
  })
  expect(change).toHaveBeenCalledOnce()
  expect(change).toHaveBeenCalledWith('exit')
  expect(document.activeElement).toBe(
    screen.getByRole('tab', { name: 'Servers' }),
  )
})
it('keeps the toggle accessible and calls its controlled change once', () => {
  const change = vi.fn()
  render(<SeaToggle label="Motion" checked onChange={change} />)
  const toggle = screen.getByRole('switch', { name: 'Motion' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(toggle)
  expect(change).toHaveBeenCalledOnce()
  expect(change).toHaveBeenCalledWith(false)
})
