// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { SeaPageFrame } from './SeaPageFrame'
afterEach(cleanup)
it('provides the full-height containing block only for the opt-in home', () => {
  const { container, rerender } = render(
    <SeaPageFrame appearance home>
      <div style={{ height: '100%' }}>Home controls</div>
    </SeaPageFrame>,
  )
  expect(
    container.querySelector<HTMLElement>('.tono-sea-page-in')?.style.height,
  ).toBe('100%')
  rerender(
    <SeaPageFrame appearance={false} home>
      <span>Legacy</span>
    </SeaPageFrame>,
  )
  expect(
    container.querySelector<HTMLElement>('.tono-page-in')?.style.height,
  ).toBe('')
})
