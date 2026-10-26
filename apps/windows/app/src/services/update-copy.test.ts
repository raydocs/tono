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
    const unmarked = describeUpdateFailure(
      new Error('Protected update stopped: connection timed out'),
      t,
    )
    expect(unmarked.sticks).toBe(true)
    expect(unmarked.message).not.toBe('tono.update.network')

    const network = describeUpdateFailure(
      new Error(
        'Protected update stopped: TONO_UPDATE_DOWNLOAD_FAILED: connection timed out',
      ),
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
    expect(replayLog.message).not.toBe('tono.update.notNewer')
    expect(replayLog.message).not.toBe('tono.update.network')
    expect(replayLog.sticks).toBe(true)
  })

  it('sticks a needs-attention or service refusal instead of calling it a network failure', () => {
    const attention = describeUpdateFailure(
      new Error('rollback not proven complete; evidence cannot be retired'),
      t,
    )
    expect(attention.sticks).toBe(true)
    expect(attention.message).not.toBe('tono.update.network')
    expect(attention.message).toBe('tono.update.needsAttention')

    const protection = describeUpdateFailure(
      new Error('network protection is uncertain'),
      t,
    )
    expect(protection.sticks).toBe(true)
    expect(protection.message).not.toBe('tono.update.network')

    const barrier = describeUpdateFailure(
      new Error('a Tono Service still owns the network barrier'),
      t,
    )
    expect(barrier.sticks).toBe(true)
    expect(barrier.message).not.toBe('tono.update.network')

    const filters = describeUpdateFailure(
      new Error(
        'Tono network filters remain; the previous connection state was kept',
      ),
      t,
    )
    expect(filters.sticks).toBe(true)
    expect(filters.message).not.toBe('tono.update.network')

    const executor = describeUpdateFailure(
      new Error('the update executor did not take over within 30 seconds'),
      t,
    )
    expect(executor.sticks).toBe(true)
    expect(executor.message).not.toBe('tono.update.network')

    const incomplete = describeUpdateFailure(
      new Error(
        'update preparation is incomplete; retained evidence needs recovery',
      ),
      t,
    )
    expect(incomplete.sticks).toBe(true)
    expect(incomplete.message).not.toBe('tono.update.network')
  })

  it('does not call a leftover update a network failure', () => {
    expect(updateCheckNoticeKey('a prior update needs reconciliation')).toBe(
      'tono.update.needsAttention',
    )
    expect(updateCheckNoticeKey('connection timed out')).toBe(
      'tono.settings.about.checkFailed',
    )
    expect(updateCheckNoticeKey('network protection is uncertain')).toBe(
      'tono.update.checkUnknown',
    )
    expect(
      updateCheckNoticeKey('a Tono Service still owns the network barrier'),
    ).toBe('tono.update.checkUnknown')
    expect(
      updateCheckNoticeKey(
        'Tono network filters remain; the previous connection state was kept',
      ),
    ).toBe('tono.update.checkUnknown')
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
