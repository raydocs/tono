import { expect, it } from 'vitest'

import { homeLineParts } from './home-line-meta'

it('keeps an unmapped city separate from its codename', () => {
  expect(homeLineParts('Singapore · Harbor', (key) => key)).toEqual({
    name: 'Harbor',
    city: 'Singapore',
  })
})
