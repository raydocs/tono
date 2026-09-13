import { describe, expect, it } from 'vitest';
import type { AcceptanceItemDto, AcceptanceState, NodeAcceptanceDto, NodeErrorRowDto } from '@contract';
import { copy } from '@/copy/copy';
import { nowSec } from './clock';
import {
  acceptanceTone,
  actionBlockReason,
  anchorDayOf,
  blockerLabels,
  barSize,
  bytesToGb,
  canCancelJob,
  foldErrors,
  formatBillingCycle,
  formatDeadline,
  formatMoney,
  gbToBytes,
  NODE_ACTIONS,
  numberOrNull,
  orderedAcceptance,
  overrideRelistAction,
  parseLineTags,
  reasonSentence,
  textOrNull,
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

/** A sheet built from its own items, the way both sides derive it. */
function sheet(rows: Array<[string, AcceptanceState]>): NodeAcceptanceDto {
  const soft = new Set(['forward', 'capacity']);
  const items: AcceptanceItemDto[] = rows.map(([key, state]) => ({
    key, label: `label-${key}`, state, evidence: null, asOfSec: null, source: 'profile',
  }));
  const blockers = items
    .filter((item) => item.state !== 'pass' && !(item.state === 'unknown' && soft.has(item.key)))
    .map((item) => item.key);
  return { items, sellable: blockers.length === 0, blockers, asOfSec: null };
}

const SELLABLE = sheet([['profile', 'pass'], ['forward', 'unknown'], ['capacity', 'unknown']]);
const BLOCKED = sheet([['profile', 'fail'], ['carriers', 'fail'], ['capacity', 'unknown']]);

describe('what the action rail will let an operator do', () => {
  it('offers every action on a listed node the hub can reach', () => {
    for (const row of NODE_ACTIONS) {
      if (row.id === 'relist') continue;
      expect(actionBlockReason(row, healthy, SELLABLE), row.id).toBeNull();
    }
  });

  it('refuses everything on a node that has already been retired', () => {
    const retired: NodeActionSubject = { ...healthy, lifecycle: 'retired' };
    for (const row of NODE_ACTIONS) {
      expect(actionBlockReason(row, retired, SELLABLE), row.id).toBe(copy.nodeActionBlocked.retired);
    }
  });

  it('refuses the machine-side work when the hub is not talking to the machine', () => {
    const lost: NodeActionSubject = { ...healthy, bindings: { komari: false } };
    for (const row of NODE_ACTIONS) {
      const blocked = actionBlockReason(row, lost, SELLABLE);
      expect(blocked === copy.nodeActionBlocked.hub, row.id).toBe(row.needsHub);
    }
  });

  it('will not unlist what is not listed, nor list what already is', () => {
    const unlisted: NodeActionSubject = { ...healthy, lifecycle: 'unlisted', catalogListed: false };
    expect(actionBlockReason(action('unlist'), unlisted, SELLABLE)).toBe(copy.nodeActionBlocked.notListed);
    expect(actionBlockReason(action('relist'), unlisted, SELLABLE)).toBeNull();
    expect(actionBlockReason(action('relist'), healthy, SELLABLE)).toBe(copy.nodeActionBlocked.alreadyListed);
  });

  /** R2 reaches the buttons: a listing nobody measured is not a listing of `false`. */
  it('says so rather than guessing when the listing is unknown', () => {
    const unknown: NodeActionSubject = { ...healthy, catalogListed: null };
    for (const id of ['unlist', 'relist', 'retire'] as const) {
      expect(actionBlockReason(action(id), unknown, SELLABLE), id).toBe(copy.nodeActionBlocked.unknownListing);
    }
    expect(actionBlockReason(action('probe'), unknown, SELLABLE)).toBeNull();
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


describe('why the word, in words the operator can act on', () => {
  it('says nothing at all about a healthy machine', () => {
    // The engine writes `ok` there, and production printed it under 正常.
    expect(reasonSentence('ok', 'ok')).toBeNull();
    expect(reasonSentence('ok', '大陆正常')).toBeNull();
  });

  it('turns every token the engine can write into a sentence', () => {
    const tokens = [
      'unreachable', 'likely_blocked', 'agent_missing', 'machine_pressure',
      'snapshot_stale', 'carrier_loss', 'customer_fail', 'error_spike', 'collector_stale',
    ];
    for (const token of tokens) {
      const said = reasonSentence('degraded', token);
      expect(said, token).toBe(copy.nodeReason[token as keyof typeof copy.nodeReason]);
      expect(said, token).not.toBe(token);
    }
  });

  it('passes a sentence through untouched', () => {
    expect(reasonSentence('degraded', '联通去程成功率掉到 76%'))
      .toBe('联通去程成功率掉到 76%');
  });

  it('drops a token nobody has translated rather than printing it', () => {
    expect(reasonSentence('degraded', 'some_new_rule')).toBeNull();
    expect(reasonSentence('degraded', null)).toBeNull();
    expect(reasonSentence('degraded', '  ')).toBeNull();
  });
});

describe('what the 这台机器 form sends back', () => {
  it('reads an empty box as "there is none"', () => {
    expect(textOrNull('  ')).toBeNull();
    expect(textOrNull(' Bandwagon ')).toBe('Bandwagon');
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
    expect(numberOrNull('5.5')).toBe(5.5);
  });

  it('keeps a two-word line tag as one tag', () => {
    expect(parseLineTags('CN2 GIA · 晚高峰限速')).toEqual(['CN2 GIA', '晚高峰限速']);
    expect(parseLineTags('CMIN2，移动优先、香港中转')).toEqual(['CMIN2', '移动优先', '香港中转']);
    expect(parseLineTags('   ')).toEqual([]);
  });

  it('takes the allowance in the GB the invoice is written in, and gives it back', () => {
    const bytes = gbToBytes('1000');
    expect(bytes).toBe(1_000_000_000_000);
    expect(bytesToGb(bytes)).toBe('1000');
    expect(bytesToGb(null)).toBe('');
    expect(gbToBytes('')).toBeNull();
  });

  it('recovers the anchor day from the cycle the meter is already using', () => {
    const march9 = Math.floor(new Date(2026, 2, 9).getTime() / 1_000);
    expect(anchorDayOf(march9)).toBe('9');
    expect(anchorDayOf(null)).toBe('1');
  });
});

/**
 * 上架 is the one action gated on a second document, and the sheet is the
 * document. The three answers it can give are all different: the sheet says
 * yes, the sheet says no and names what is missing, or the sheet has not come
 * back — and the third must never read as the first.
 */
describe('the 可售验收单 and what it lets 上架 do', () => {
  const unlisted: NodeActionSubject = { ...healthy, lifecycle: 'unlisted', catalogListed: false };

  it('refuses 上架 with the blockers named, and waits rather than guessing', () => {
    const refused = actionBlockReason(action('relist'), unlisted, BLOCKED);
    expect(refused).toContain('2');
    expect(refused).toContain('label-carriers');
    expect(actionBlockReason(action('relist'), unlisted, null))
      .toBe(copy.nodeActionBlocked.acceptanceUnread);
    expect(actionBlockReason(action('relist'), unlisted, SELLABLE)).toBeNull();
  });

  it('leaves every other action alone whatever the sheet says', () => {
    for (const row of NODE_ACTIONS) {
      if (row.id === 'relist') continue;
      expect(actionBlockReason(row, unlisted, BLOCKED), row.id)
        .not.toBe(copy.nodeActionBlocked.acceptanceUnread);
    }
  });

  it('reads the blockers back as the labels the sheet shows them under', () => {
    expect(blockerLabels(BLOCKED)).toEqual(['label-profile', 'label-carriers']);
    expect(blockerLabels(SELLABLE)).toEqual([]);
  });

  it('puts what is blocking 上架 first and keeps the rest in order', () => {
    const mixed = sheet([
      ['profile', 'pass'], ['carriers', 'fail'], ['quota', 'pass'], ['errors', 'pending'],
    ]);
    expect(orderedAcceptance(mixed).map((row) => row.key))
      .toEqual(['carriers', 'errors', 'profile', 'quota']);
  });

  it('gives each state its own tone, and only the failing one an alarm', () => {
    expect(acceptanceTone('fail')).toBe('sev');
    expect(acceptanceTone('unknown')).toBe('unk');
    expect(acceptanceTone('pending')).toBe('info');
    expect(acceptanceTone('pass')).toBe('ok');
  });

  it('repeats the blockers in the 仍要上架 confirmation, and marks it an override', () => {
    const override = overrideRelistAction(BLOCKED);
    expect(override.override).toBe(true);
    expect(override.jobType).toBe('catalog_relist');
    expect(override.destructive).toBe(true);
    expect(override.label).toBe(copy.nodeAcceptanceOverride);
    expect(override.consequence).toContain('label-carriers');
    expect(override.consequence).toContain(copy.nodeActionConsequence.relist);
  });
});
