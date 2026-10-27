import { describe, expect, it } from 'vitest';
import {
  assertConnectionEvent,
  assertCustomerSummary,
  assertIncident,
  assertList,
  assertNodeSummary,
  type ConnectionEventDto,
  type CustomerSummaryDto,
  type IncidentDto,
  type NodeSummaryDto,
} from '@contract';
import { copy } from '@/copy/copy';
import raw from '../../fixtures/customers.json';
import rawIncidents from '../../fixtures/incidents.json';
import rawNodes from '../../fixtures/nodes.json';
import { explainCode } from './codes';
import {
  bucketCounts,
  CUSTOMER_FILTERS,
  customerCounts,
  lastFailedAttempt,
  newestOpenFollowups,
  planWired,
  PLATFORM_CHIPS,
  platformCounts,
  publicIncidentOn,
  releasedPlatforms,
  replyDraft,
  selectByPlatform,
  selectByBucket,
  selectCustomers,
  spareNode,
} from './customers';

const rows: CustomerSummaryDto[] = assertList(
  (raw as { list: unknown }).list,
  assertCustomerSummary,
).items;

describe('customer selectors', () => {
  it('uses the same function for the sentence and the table', () => {
    const counts = customerCounts(rows);
    for (const filter of CUSTOMER_FILTERS) {
      expect(counts[filter], filter).toBe(selectCustomers(rows, filter).length);
    }
  });

  it('counts exactly the fragments the sentence offers', () => {
    expect(Object.keys(customerCounts(rows)).sort()).toEqual([...CUSTOMER_FILTERS].sort());
    for (const filter of CUSTOMER_FILTERS) {
      expect(copy.customerCount[filter], filter).toBeTypeOf('function');
    }
  });

  it('reads the sentence the page was designed around', () => {
    const counts = customerCounts(rows);
    expect(copy.customerCount.all(counts.all)).toBe('20 位客户');
    expect(copy.customerCount.ok(counts.ok)).toBe('4 位正常');
    expect(copy.customerCount.unreachable(counts.unreachable)).toBe('1 位连不上');
  });

  /**
   * R4 as the operator checks it: click the fragment, read the rows, and every
   * row repeats the word that was just counted.
   */
  it('counts only the rows that carry the word the fragment says', () => {
    const well = selectCustomers(rows, 'ok');
    expect(well.length).toBeGreaterThan(0);
    for (const row of well) expect(row.health, row.userId).toBe(copy.customerHealth.ok);
    const unreachable = selectCustomers(rows, 'unreachable');
    expect(unreachable.length).toBeGreaterThan(0);
    for (const row of unreachable) {
      expect(row.health, row.userId).toBe(copy.customerHealth.unreachable);
    }
  });

  /**
   * R1 at the selector, not at the pixel: a customer whose client has never
   * reported must not be counted, and neither must one whose last word was
   * "connected" a day ago — that is the row production counted while the row
   * itself read 离线.
   */
  it('never counts a customer the table calls something else', () => {
    const unreported = rows.filter((row) => row.connected.asOfSec === null);
    expect(unreported.length).toBeGreaterThan(0);
    const well = selectCustomers(rows, 'ok');
    for (const row of unreported) expect(well).not.toContain(row);

    const stale: CustomerSummaryDto = {
      ...rows[0],
      userId: 'u-stale',
      verdict: 'offline',
      health: copy.customerHealth.offline,
      connected: { value: true, asOfSec: rows[0].connected.asOfSec, source: 'telemetry' },
    };
    const withStale = [...rows, stale];
    expect(customerCounts(withStale).ok).toBe(customerCounts(rows).ok);
    expect(selectCustomers(withStale, 'ok')).not.toContain(stale);
  });

  /**
   * The three plan columns are one group: this fleet has expiry dates, so they
   * are shown, and a fleet with none of the three would hide all three rather
   * than keep a column of dashes across the addresses.
   */
  it('shows the plan columns only while some row has something in one', () => {
    expect(planWired(rows)).toBe(true);
    const blank = rows.map((row) => ({
      ...row,
      services: [],
      minAppVersion: null,
      expiresAt: null,
    }));
    expect(planWired(blank)).toBe(false);
    expect(planWired([])).toBe(false);
  });

  /**
   * A cell of the matrix is "this platform's oldest version"; the all-platform
   * minimum would drop a current Windows customer with one old Mac out of the
   * Windows 最新 cell they were clicked from.
   */
  it('judges the band on the selected platform, not on the oldest device anywhere', () => {
    const row: CustomerSummaryDto = {
      ...rows[0],
      minAppVersion: '0.0.30',
      versionByPlatform: [
        { platform: 'windows', version: '0.0.34' },
        { platform: 'macos', version: '0.0.30' },
      ],
    };
    const published = ['0.0.34', '0.0.33'];
    expect(selectByBucket([row], published, 'current', 'windows')).toEqual([row]);
    expect(selectByBucket([row], published, 'behind_more', 'windows')).toEqual([]);
    expect(bucketCounts([row], published, 'windows').current).toBe(1);
    expect(selectByBucket([row], published, 'behind_more', null)).toEqual([row]);
    expect(selectByBucket([row], published, 'current', null)).toEqual([]);
    // A platform the customer has nothing on is unreported there, not behind.
    expect(selectByBucket([row], published, 'unreported', 'linux')).toEqual([row]);
  });

  it('offers all five platform chips, whether or not anything ships for them', () => {
    expect(PLATFORM_CHIPS.length).toBe(5);
    const counts = platformCounts(rows);
    const live = releasedPlatforms(rows);
    for (const platform of PLATFORM_CHIPS) {
      expect(counts[platform], platform).toBe(selectByPlatform(rows, platform).length);
      if (!live.has(platform)) expect(counts[platform], platform).toBe(0);
    }
    // Nothing has shipped for three of them, so three chips say 未发布.
    expect(PLATFORM_CHIPS.filter((platform) => !live.has(platform)).length).toBe(3);
  });

  it('the platform filter narrows without ever dropping a row into nowhere', () => {
    const withPlatform = rows.filter((row) => row.platforms.length > 0);
    const covered = new Set<string>();
    for (const platform of PLATFORM_CHIPS) {
      for (const row of selectByPlatform(rows, platform)) covered.add(row.userId);
    }
    expect(covered.size).toBe(withPlatform.length);
  });
});

describe('the reply draft', () => {
  const events: ConnectionEventDto[] = assertList(
    (raw as { details: Record<string, { connections: unknown }> }).details['u-04'].connections,
    assertConnectionEvent,
  ).items;
  const incidents: IncidentDto[] = assertList(
    (rawIncidents as { list: unknown }).list,
    assertIncident,
  ).items;
  const nodes: NodeSummaryDto[] = assertList(
    (rawNodes as { list: unknown }).list,
    assertNodeSummary,
  ).items;

  const failure = lastFailedAttempt(events)!;

  it('quotes the newest attempt that actually failed', () => {
    expect(failure.kind).toBe('connectFail');
    for (const row of events) {
      if (row.kind === 'connectFail') expect(row.atMs).toBeLessThanOrEqual(failure.atMs);
    }
  });

  /**
   * The whole point of the draft: an operator can hand any line of it back to
   * the page it came from. So every sentence has to be one of the copy
   * functions, fed a field — never prose the console made up.
   */
  it('says only what the fields say', () => {
    const incident = publicIncidentOn(incidents, failure.node);
    const spare = spareNode(nodes, failure.node);
    const text = replyDraft({ who: 'wang.tao@example.com', failure, incident, spare });
    expect(text).toContain(copy.replyLine.greeting('wang.tao@example.com'));
    expect(text).toContain(failure.node!);
    expect(text).toContain(failure.code!);
    expect(text).toContain(explainCode(failure.code)!);
    expect(text).toContain(incident!.title);
    expect(text).toContain(spare!);
    expect(text).toContain(copy.replyQuestion.other);
  });

  /**
   * The one word the draft may never reach for on its own.
   *
   * 被墙 does appear above — inside the incident's own title, which is a field
   * an operator can open and check. What must never happen is the console
   * reaching that conclusion itself, so with no incident quoted the draft has
   * no cause in it at all.
   */
  it('names no cause the fields did not name', () => {
    const text = replyDraft({ who: 'a@b.c', failure, incident: null, spare: null });
    for (const invented of ['被墙', '限速', '一定', '马上就好']) {
      expect(text, invented).not.toContain(invented);
    }
  });

  it('never recommends the machine that just failed', () => {
    expect(spareNode(nodes, failure.node)).not.toBe(failure.node);
  });

  it('says there is no incident rather than implying one', () => {
    const text = replyDraft({ who: 'a@b.c', failure, incident: null, spare: null });
    expect(text).toContain(copy.replyLine.incidentNo);
    expect(text).toContain(copy.replyLine.alternativeNone);
  });

  it('asks the question the reported code calls for', () => {
    const stale = { ...failure, code: 'CATALOG_STALE' };
    const text = replyDraft({ who: 'a@b.c', failure: stale, incident: null, spare: null });
    expect(text).toContain(copy.replyQuestion.CATALOG_STALE);
  });

  it('words the stale catalog sentence in ten characters, without the filler 手里', () => {
    const sentence = copy.codeWord.CATALOG_STALE;
    expect([...sentence]).toHaveLength(10);
    expect(sentence).not.toContain('\u624b\u91cc');
    expect(explainCode('CATALOG_STALE')).toBe(sentence);
  });

  it('explains the Windows handshake taxonomy instead of 客户端没说原因', () => {
    expect(explainCode('CORE_EXIT_UNREACHABLE')).toBe(copy.codeWord.CORE_EXIT_UNREACHABLE);
    expect(explainCode('TONO_NODE_OR_CORE_UNREACHABLE')).toBe(
      copy.codeWord.TONO_NODE_OR_CORE_UNREACHABLE,
    );
    expect(explainCode('CORE_EXIT_UNREACHABLE')).not.toBe(copy.codeWord.UNKNOWN);
  });

  it('explains the 0.0.81 codes: the exit that never answered and the engine that quit', () => {
    expect(explainCode('TONO_EXIT_UNREACHABLE')).toBe(copy.codeWord.TONO_EXIT_UNREACHABLE);
    expect(explainCode('TONO_EXIT_UNREACHABLE')).toContain('换节点');
    expect(explainCode('TONO_CORE_EXITED')).toBe(copy.codeWord.TONO_CORE_EXITED);
    expect(explainCode('TONO_CORE_EXITED')).not.toBe(copy.codeWord.UNKNOWN);
  });

  it('says the Windows service-down code in a sentence, not the raw code', () => {
    expect(explainCode('TONO_SERVICE_NOT_RUNNING')).toBe(copy.codeWord.TONO_SERVICE_NOT_RUNNING);
    expect(explainCode('TONO_SERVICE_NOT_RUNNING')).not.toBe('TONO_SERVICE_NOT_RUNNING');
    expect(explainCode('TONO_SERVICE_NOT_RUNNING')).not.toBe(copy.codeWord.UNKNOWN);
  });
});

describe('the followup column', () => {
  const at = 1_788_895_426;
  const base = {
    subjectType: 'user' as const,
    body: 'x',
    dueAt: null,
    doneAt: null,
    createdBy: null,
    updatedAt: at,
  };

  it('shows the newest thing still owed, and nothing that is finished', () => {
    const index = newestOpenFollowups([
      { ...base, id: '1', subjectId: 'u-01', kind: 'reply', createdAt: at - 100 },
      { ...base, id: '2', subjectId: 'u-01', kind: 'callback', createdAt: at - 10 },
      { ...base, id: '3', subjectId: 'u-02', kind: 'note', createdAt: at, doneAt: at },
      { ...base, id: '4', subjectType: 'incident', subjectId: 'inc-1', kind: 'note', createdAt: at },
    ]);
    expect(index.get('u-01')?.id).toBe('2');
    expect(index.has('u-02')).toBe(false);
    expect(index.has('inc-1')).toBe(false);
  });
});
