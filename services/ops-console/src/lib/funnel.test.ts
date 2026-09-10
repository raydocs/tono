import { describe, expect, it } from 'vitest';
import {
  assertCustomerSummary,
  assertFunnel,
  assertList,
  FUNNEL_STAGES,
  type CustomerSummaryDto,
  type FunnelDto,
} from '@contract';
import { copy } from '@/copy/copy';
import raw from '../../fixtures/customers.json';
import rawFunnel from '../../fixtures/funnel.json';
import { customerChores, inviteChores } from './chores';
import { materializeOps } from './ops-fixtures';
import {
  daysSince,
  invitesOf,
  listRows,
  selectByStage,
  stageCounts,
  stageSentence,
  STUCK_DAYS,
} from './funnel';

const rows: CustomerSummaryDto[] = assertList(
  (raw as { list: unknown }).list,
  assertCustomerSummary,
).items;

const funnel: FunnelDto = assertFunnel((rawFunnel as { funnel: unknown }).funnel);
const clock = (rawFunnel as { clock: number }).clock;
const DAY = 86_400;

describe('the funnel bar and the table under it', () => {
  const table = listRows(rows, invitesOf(funnel));

  /**
   * R4 for the fifth time on this page: the segment and the rows it filters to
   * are one predicate. A bar counted from the wire while the table filters in
   * the browser is how "5 位" ends up over four rows.
   */
  it('counts each segment with the selector the table filters by', () => {
    const counts = stageCounts(table);
    for (const stage of FUNNEL_STAGES) {
      expect(counts[stage], stage).toBe(selectByStage(table, stage).length);
    }
  });

  it('loses nobody between the five segments', () => {
    const counts = stageCounts(table);
    const total = FUNNEL_STAGES.reduce((sum, stage) => sum + counts[stage], 0);
    expect(total).toBe(table.length);
  });

  /**
   * The people on the funnel who already have a customer row must not be added
   * to the table a second time: they arrive with their own stage on the
   * customer list, and counting them twice would inflate every segment.
   */
  it('takes only the people who have no customer row from the funnel', () => {
    const invites = invitesOf(funnel);
    expect(invites.length).toBeGreaterThan(0);
    for (const row of invites) expect(row.userId).toBeNull();
    expect(table.length).toBe(rows.length + invites.length);
    const ids = new Set(table.map((row) => row.key));
    expect(ids.size).toBe(table.length);
  });

  it('reads the four unfinished segments off the fixture the pages were written against', () => {
    const counts = stageCounts(table);
    expect(copy.funnelCount.invited(counts.invited)).toBe('2 位开通了还没注册');
    expect(copy.funnelCount.registered(counts.registered)).toBe('1 位注册了还没装客户端');
    expect(copy.funnelCount.device_added(counts.device_added)).toBe('1 位装了还没上报');
    expect(copy.funnelCount.reported(counts.reported)).toBe('1 位上报过还没连上');
    expect(copy.funnelCount.connected(counts.connected)).toBe('17 位连上过');
  });
});

describe('the one sentence a stuck row is worth', () => {
  it('counts whole days and never a fraction of one', () => {
    expect(daysSince(clock - 5 * DAY, clock)).toBe(5);
    expect(daysSince(clock - (5 * DAY - 60), clock)).toBe(4);
    expect(daysSince(clock + DAY, clock)).toBe(0);
  });

  it('says which step, and how long they have been on it', () => {
    expect(stageSentence('invited', clock - 5 * DAY, clock)).toBe('开通 5 天还没注册');
    expect(stageSentence('registered', clock - 3 * DAY, clock)).toBe('注册 3 天还没装客户端');
    expect(stageSentence('device_added', clock - 4 * DAY, clock)).toBe('装了 4 天还没上报');
  });

  /**
   * The client reported once and has said nothing since, so there is no day to
   * count from — a number here would be one the console cannot stand behind.
   */
  it('gives the reported step no day count at all', () => {
    expect(stageSentence('reported', clock - 9 * DAY, clock)).toBe('上报过，还没连上过');
    expect(stageSentence('reported', clock - DAY, clock)).toBe('上报过，还没连上过');
  });
});

/**
 * The chore half is read off the fixtures moved to now, exactly as the dev
 * server serves them. The files are written against a fixed clock, and "stuck
 * for three days" measured against a stamp from 2024 is true of everybody —
 * which would make the three-day line untestable.
 */
describe('开通跟进 as a chore', () => {
  const plain = (email: string) => email;
  const liveRows = assertList(
    materializeOps(raw as { clock: number; list: unknown }, clock).list,
    assertCustomerSummary,
  ).items;
  const liveFunnel = assertFunnel(
    materializeOps(rawFunnel as { clock: number; funnel: unknown }, clock).funnel,
  );
  const liveInvites = invitesOf(liveFunnel);

  it('chases everybody stuck past the line, from both halves of the funnel', () => {
    const mine = customerChores(liveRows, plain).filter((chore) => chore.kind === 'onboarding');
    const theirs = inviteChores(liveInvites, plain);
    expect(mine.map((chore) => chore.id).sort()).toEqual([
      'onboarding:u-06', 'onboarding:u-11', 'onboarding:u-17',
    ]);
    expect(theirs.map((chore) => chore.id)).toEqual(['onboarding:invite:shu.qing@example.com']);
  });

  /** Nobody who connected is ever chased about not having connected. */
  it('leaves the people who got there alone', () => {
    for (const chore of customerChores(liveRows, plain)) {
      if (chore.kind !== 'onboarding') continue;
      const row = liveRows.find((item) => item.userId === chore.who?.userId);
      expect(row?.stage, chore.id).not.toBe('connected');
    }
  });

  it('carries the handle and the way in on every onboarding row', () => {
    const all = [
      ...customerChores(liveRows, plain).filter((chore) => chore.kind === 'onboarding'),
      ...inviteChores(liveInvites, plain),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const chore of all) {
      expect(chore.who, chore.id).toBeTruthy();
      expect(chore.who?.email, chore.id).toContain('@');
      // Dated at the day it fell due, so it sorts with the rest and shows up
      // in the morning read rather than sinking to the bottom undated.
      expect(chore.dueAt, chore.id).not.toBeNull();
    }
  });

  it('holds back the invitation that is younger than the line', () => {
    const fresh = liveInvites.filter((row) => daysSince(row.stageSinceAt) < STUCK_DAYS);
    expect(fresh.length).toBeGreaterThan(0);
    const chased = new Set(inviteChores(liveInvites, plain).map((chore) => chore.who?.email));
    for (const row of fresh) expect(chased.has(row.email), row.email).toBe(false);
  });
});
