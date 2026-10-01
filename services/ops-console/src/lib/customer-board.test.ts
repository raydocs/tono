import { describe, expect, it } from 'vitest';
import type { CustomerSummaryDto } from '@contract';
import { copy } from '@/copy/copy';
import { expiryWeeks, listStats } from './customer-board';

const NOW = 1_800_000_000;
const DAY = 86_400;

const customer = (patch: Partial<CustomerSummaryDto>): CustomerSummaryDto => ({
  userId: 'u',
  email: 'u@example.test',
  wechatId: null,
  verdict: 'ok',
  health: copy.customerHealth.ok,
  tone: 'ok',
  reason: null,
  lifecycle: 'active',
  deviceCount: 1,
  platforms: ['macos'],
  selectedServer: null,
  connected: { value: false, asOfSec: null, source: 'telemetry' },
  lastFailure: null,
  usageBytes: { value: 0, asOfSec: null, source: 'telemetry' },
  quotaBytes: null,
  services: [],
  minAppVersion: null,
  expiresAt: null,
  lastSeenAt: null,
  stage: 'connected',
  stageSinceAt: 0,
  firstConnectedAt: null,
  updatedAt: 0,
  ...patch,
});

describe('customer board', () => {
  it('counts only metered usage, and a suspended account not at all', () => {
    const stats = listStats([
      customer({ usageBytes: { value: 90, asOfSec: NOW, source: 'telemetry' }, quotaBytes: 100 }),
      customer({ usageBytes: { value: 0, asOfSec: null, source: 'telemetry' } }),
      customer({ lifecycle: 'suspended', usageBytes: { value: 500, asOfSec: NOW, source: 'telemetry' } }),
    ], NOW);
    expect([stats.active, stats.usage, stats.unmetered, stats.nearQuota]).toEqual([2, 90, 1, 1]);
  });

  it('puts lapsed customers in the first expiry column and drops the ones past the window', () => {
    expect(expiryWeeks([
      customer({ expiresAt: NOW - DAY }),
      customer({ expiresAt: NOW + 2 * DAY }),
      customer({ expiresAt: NOW + 9 * DAY }),
      customer({ expiresAt: NOW + 90 * DAY }),
    ], NOW, 4)).toEqual([1, 1, 1, 0, 0]);
  });

  it('counts API-expired customers as overdue while keeping them out of active load and usage', () => {
    const stats = listStats([
      customer({
        expiresAt: NOW + 2 * DAY, quotaBytes: 100,
        connected: { value: true, asOfSec: NOW, source: 'telemetry' },
        usageBytes: { value: 90, asOfSec: NOW, source: 'telemetry' },
        lastSeenAt: NOW,
      }),
      customer({
        lifecycle: 'expired', expiresAt: NOW - DAY, quotaBytes: 100,
        connected: { value: true, asOfSec: NOW, source: 'telemetry' },
        usageBytes: { value: 1_000, asOfSec: NOW, source: 'telemetry' },
        lastSeenAt: NOW,
      }),
      customer({ lifecycle: 'suspended', expiresAt: NOW - DAY }),
      customer({ expiresAt: NOW - 1 }), // A loaded active row crosses expiry before refresh.
    ], NOW);
    expect(stats).toEqual({
      active: 2, online: 1, reporting: 1, seenWeek: 1, failedDay: 0,
      usage: 90, unmetered: 1, nearQuota: 1, expiringWeek: 1, expired: 2,
    });
  });

  it('keeps API-expired customers in the lapsed column while reserving upcoming columns for active accounts', () => {
    expect(expiryWeeks([
      customer({ lifecycle: 'expired', expiresAt: NOW - DAY }),
      customer({ expiresAt: NOW - 1 }),
      customer({ lifecycle: 'suspended', expiresAt: NOW - DAY }),
      customer({ lifecycle: 'expired', expiresAt: NOW + 2 * DAY }),
      customer({ lifecycle: 'expired', expiresAt: null }),
      customer({ expiresAt: NOW + 2 * DAY }),
      customer({ expiresAt: NOW + 9 * DAY }),
      customer({ expiresAt: NOW + 90 * DAY }),
    ], NOW, 4)).toEqual([2, 1, 1, 0, 0]);
  });
});
