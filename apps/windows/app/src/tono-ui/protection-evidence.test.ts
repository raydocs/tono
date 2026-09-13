import { describe, expect, it } from 'vitest'

import { hasLiveProtection } from './protection-evidence'

describe('offline protection presentation evidence', () => {
  it('treats missing Service evidence as unknown, not a proven barrier', () => {
    expect(hasLiveProtection()).toBe(false)
    expect(hasLiveProtection({ killSwitch: null })).toBe(false)
  })
  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'requires wanted and live (wanted=%s live=%s)', (wanted, live) => {
      expect(hasLiveProtection({ killSwitch: {
        wanted, live, mode: 'blocked', endpoints: [], last_error: null,
      } })).toBe(wanted && live)
    },
  )
})
