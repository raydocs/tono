import { describe, expect, it } from 'vitest';
import type { NodeErrorRowDto } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import {
  actionBlockReason,
  barSize,
  canCancelJob,
  foldErrors,
  formatBillingCycle,
  formatDeadline,
  formatMoney,
  NODE_ACTIONS,
  type NodeActionId,
  type NodeActionSubject,
} from './node-detail';

const action = (id: NodeActionId) => {
  const found = NODE_ACTIONS.find((row) => row.id === id);
  if (!found) throw new Error(id);
  return found;
};

const healthy: NodeActionSubject = {
  lifecycle: 'listed',
  catalogListed: true,
  bindings: { komari: true },
};

describe('what the action rail will let an operator do', () => {
  it('offers every action on a listed node the hub can reach', () => {
    for (const row of NODE_ACTIONS) {
      if (row.id === 'relist') continue;
      expect(actionBlockReason(row, healthy), row.id).toBeNull();
    }
  });

  it('refuses everything on a node that has already been retired', () => {
    const retired: NodeActionSubject = { ...healthy, lifecycle: 'retired' };
    for (const row of NODE_ACTIONS) {
      expect(actionBlockReason(row, retired), row.id).toBe(copy.nodeActionBlocked.retired);
    }
  });

  it('refuses the machine-side work when the hub is not talking to the machine', () => {
    const lost: NodeActionSubject = { ...healthy, bindings: { komari: false } };
    for (const row of NODE_ACTIONS) {
      const blocked = actionBlockReason(row, lost);
      expect(blocked === copy.nodeActionBlocked.hub, row.id).toBe(row.needsHub);
    }
  });

  it('will not unlist what is not listed, nor list what already is', () => {
    const unlisted: NodeActionSubject = { ...healthy, lifecycle: 'unlisted', catalogListed: false };
    expect(actionBlockReason(action('unlist'), unlisted)).toBe(copy.nodeActionBlocked.notListed);
    expect(actionBlockReason(action('relist'), unlisted)).toBeNull();
    expect(actionBlockReason(action('relist'), healthy)).toBe(copy.nodeActionBlocked.alreadyListed);
  });

  /** R2 reaches the buttons: a listing nobody measured is not a listing of `false`. */
  it('says so rather than guessing when the listing is unknown', () => {
    const unknown: NodeActionSubject = { ...healthy, catalogListed: null };
    for (const id of ['unlist', 'relist', 'retire'] as const) {
      expect(actionBlockReason(action(id), unknown), id).toBe(copy.nodeActionBlocked.unknownListing);
    }
    expect(actionBlockReason(action('probe'), unknown)).toBeNull();
  });

  it('asks for the node name back before anything that changes the machine', () => {
    const destructive = NODE_ACTIONS.filter((row) => row.destructive).map((row) => row.id);
    expect(destructive).toEqual(['unlist', 'relist', 'identitySync', 'restart', 'retire']);
  });

  it('only offers to call off work that has not finished', () => {
    expect(canCancelJob('queued')).toBe(true);
    expect(canCancelJob('leased')).toBe(true);
    for (const status of ['succeeded', 'failed', 'cancelled', 'expired'] as const) {
      expect(canCancelJob(status), status).toBe(false);
    }
  });
});

describe('the facts that need formatting', () => {
  it('puts a symbol in front and a code behind', () => {
    expect(formatMoney(5.5, '$')).toBe('$5.5');
    expect(formatMoney(12, 'USD')).toBe('12 USD');
  });

  it('drops trailing zeros and keeps two decimals at most', () => {
    expect(formatMoney(12.0, '$')).toBe('$12');
    expect(formatMoney(5.499, '$')).toBe('$5.5');
  });

  it('has nothing to print when nobody wrote the price down', () => {
    expect(formatMoney(null, '$')).toBeNull();
    expect(formatMoney(5, null)).toBe('5');
    expect(formatBillingCycle(null)).toBeNull();
    expect(formatBillingCycle(0)).toBeNull();
    expect(formatBillingCycle(30)).toBe(copy.nodeCycleDays('30'));
  });

  it('points a renewal forwards instead of calling next month 刚刚', () => {
    const now = nowSec();
    expect(formatDeadline(now + 8 * 86400)).toBe(copy.nodeAhead.days('8'));
    expect(formatDeadline(now + 5 * 3600)).toBe(copy.nodeAhead.hours('5'));
    expect(formatDeadline(now + 60)).toBe(copy.nodeAhead.soon);
    expect(formatDeadline(null)).toBeNull();
  });

  it('reads an expiry that has already passed as the past', () => {
    expect(formatDeadline(nowSec() - 3 * 86400)).toBe(copy.ago.days(3));
  });

  it('keeps a single error visible instead of drawing nothing', () => {
    expect(barSize(0, 40)).toBe('2px');
    expect(barSize(1, 40)).toBe('8%');
    expect(barSize(40, 40)).toBe('100%');
    expect(barSize(3, 0)).toBe('2px');
  });
});

describe('folding the error rows into categories', () => {
  const rows: NodeErrorRowDto[] = [
    { dayAt: 200, category: 'b', count: 2, sample: 'newer b' },
    { dayAt: 100, category: 'a', count: 4, sample: null },
    { dayAt: 200, category: 'a', count: 5, sample: 'newest a' },
    { dayAt: 100, category: 'b', count: 1, sample: 'older b' },
  ];

  it('counts each category once and puts the loudest first', () => {
    const folded = foldErrors(rows);
    expect(folded.map((row) => row.category)).toEqual(['a', 'b']);
    expect(folded[0].total).toBe(9);
    expect(folded[1].total).toBe(3);
  });

  it('keeps the days in order so the bars read left to right', () => {
    expect(foldErrors(rows)[0].days.map((row) => row.dayAt)).toEqual([100, 200]);
  });

  it('shows the newest line the machine printed, not the first one seen', () => {
    const folded = foldErrors(rows);
    expect(folded[0].sample).toBe('newest a');
    expect(folded[1].sample).toBe('newer b');
  });

  it('has nothing to fold when nothing was reported', () => {
    expect(foldErrors([])).toEqual([]);
  });
});
