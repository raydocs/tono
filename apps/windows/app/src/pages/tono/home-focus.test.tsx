// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { useHomeDialog } from './home-focus'

afterEach(cleanup)

it('lets a confirmation opened inside the sheet take Escape before the sheet closes', () => {
  const close = vi.fn()
  const Sheet = ({ confirming }: { confirming: boolean }) => {
    const panel = useRef<HTMLDivElement>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    useHomeDialog(true, panel, trigger, close)
    return (
      <div ref={panel} tabIndex={-1}>
        <button type="button" ref={trigger}>
          Rules
        </button>
        {confirming && <div role="dialog" aria-modal="true" />}
      </div>
    )
  }
  const { rerender } = render(<Sheet confirming />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  rerender(<Sheet confirming={false} />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalledTimes(1)
})
