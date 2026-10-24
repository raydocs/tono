// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import en from '@/locales/en/tono.json'
import zh from '@/locales/zh/tono.json'

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

    const downgrade = describeUpdateFailure(
      new Error('release replay/downgrade refused'),
      t,
    )
    expect(downgrade.message).toBe('tono.update.notNewer')
    expect(downgrade.sticks).toBe(true)

    const otherOwner = describeUpdateFailure(
      new Error('active session belongs to another owner'),
      t,
    )
    expect(otherOwner.message).toBe('tono.update.refused')
    expect(otherOwner.sticks).toBe(true)
    expect(en.update.refused).not.toMatch(/protection is unchanged/i)
    expect(zh.update.refused).not.toContain('网络保护没有变化')

    const replayLog = describeUpdateFailure(new Error('no Core replay'), t)
    expect(replayLog.message).toBe('tono.update.notCompleted')
    expect(replayLog.sticks).toBe(false)
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
    expect(
      updateCheckNoticeKey(
        'rollback not proven complete; evidence cannot be retired',
      ),
    ).toBe('tono.update.needsAttention')
    expect(
      updateCheckNoticeKey(
        'automatic update recovery failed 3 times and stopped; the installation needs manual repair',
      ),
    ).toBe('tono.update.needsAttention')
    expect(en.update.needsAttention).not.toMatch(/Update now/)
    expect(zh.update.needsAttention).not.toContain('现在更新')
  })

  it('hides one manifest for 24 hours and leaves the next one visible', () => {
    const now = 1_700_000_000_000
    snoozeUpdate('ab', now)
    expect(updateSnoozed('ab', now + UPDATE_LATER_MS - 1)).toBe(true)
    expect(updateSnoozed('ab', now + UPDATE_LATER_MS)).toBe(false)
    expect(updateSnoozed('cd', now + 1)).toBe(false)
  })
})
