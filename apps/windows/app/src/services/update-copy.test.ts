// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  UPDATE_LATER_MS,
  describeUpdateFailure,
  snoozeUpdate,
  updateCheckNoticeKey,
  updateSnoozed,
} from './update-copy'

const t = (key: string) => key

describe('update failure copy', () => {
  beforeEach(() => localStorage.clear())

  it('keeps a network failure retryable and sticks a signature or service refusal', () => {
    const network = describeUpdateFailure(
      new Error('Protected update stopped: connection timed out'),
      t,
    )
    expect(network.message).toBe('tono.update.network')
    expect(network.sticks).toBe(false)
    expect(network.detail).toContain('connection timed out')

    const refused = describeUpdateFailure(
      new Error('Service refused: protection retained'),
      t,
    )
    expect(refused.message).toBe('tono.update.refused')
    expect(refused.sticks).toBe(true)

    const signature = describeUpdateFailure(
      new Error('ed25519 signature rejected'),
      t,
    )
    expect(signature.message).toBe('tono.update.signatureRefused')
    expect(signature.sticks).toBe(true)

    const older = describeUpdateFailure(
      new Error('release sequence is not newer than the installed floor'),
      t,
    )
    expect(older.message).toBe('tono.update.notNewer')
    expect(older.sticks).toBe(true)
  })

  it('does not call a leftover update a network failure', () => {
    expect(updateCheckNoticeKey('a prior update needs reconciliation')).toBe(
      'tono.update.needsAttention',
    )
    expect(updateCheckNoticeKey('connection timed out')).toBe(
      'tono.settings.about.checkFailed',
    )
    expect(updateCheckNoticeKey('Service refused: protection retained')).toBe(
      'tono.update.checkUnknown',
    )
  })

  it('hides one manifest for 24 hours and leaves the next one visible', () => {
    const now = 1_700_000_000_000
    snoozeUpdate('ab', now)
    expect(updateSnoozed('ab', now + UPDATE_LATER_MS - 1)).toBe(true)
    expect(updateSnoozed('ab', now + UPDATE_LATER_MS)).toBe(false)
    expect(updateSnoozed('cd', now + 1)).toBe(false)
  })
})
