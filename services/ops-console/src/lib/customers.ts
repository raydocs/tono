import type {
  AdoptionBucket,
  ConnectionEventDto,
  CustomerDeviceDto,
  CustomerSummaryDto,
  IncidentDto,
  NodeSummaryDto,
  Platform,
} from '@contract';
import { ADOPTION_BUCKETS } from '@contract';
import { copy } from '@/copy/copy';
import type { FollowupDto } from './api-followups';
import { explainCode, isFailure, stageWord } from './codes';
import { formatWhen } from './display';
import { bucketFor } from './releases';

const DAY = 86_400;

/** How far 续 30 天 moves a date, in the one place both callers read it from. */
export const RENEW_DAYS = 30;

/**
 * Extending is measured from whichever is later: today, or the date already
 * paid for.
 *
 * Anchoring at "now" reads as the kinder default and is the one that loses a
 * customer money — a renewal pressed a fortnight early used to shorten a
 * runway from six weeks to four. The old console fixed this the same way; the
 * rule travels with the arithmetic so the list's batch renewal and the detail
 * page's button cannot drift apart.
 */
export function extendedExpiry(current: number | null, now: number): number {
  return Math.max(now, current ?? now) + RENEW_DAYS * DAY;
}

/** Whom 到期客户续 30 天 would actually move: a customer with no date is unlimited. */
export function renewable(rows: readonly CustomerSummaryDto[]): CustomerSummaryDto[] {
  return rows.filter((row) => row.expiresAt !== null);
}

/**
 * The four remote actions, and which clients can carry out any of them.
 *
 * The capability is on the platform rather than on the button because that is
 * where it actually lives: the queue accepts all four for any device, and a
 * client that does not implement one leaves the row pending until it expires
 * five minutes later — a button that looks like it worked and did nothing.
 * macOS and Windows implement all four today. The rest ship no action handler
 * at all, so their rows say which platform is missing it rather than greying
 * out with no reason.
 */
export const DEVICE_ACTIONS = [
  'diagnostic_snapshot',
  'claude_traffic_snapshot',
  'refresh_catalog',
  'retry_protection',
] as const;

export type DeviceActionId = (typeof DEVICE_ACTIONS)[number];

const PLATFORM_ACTIONS: Record<Platform, readonly DeviceActionId[]> = {
  macos: DEVICE_ACTIONS,
  windows: DEVICE_ACTIONS,
  linux: [],
  android: [],
  ios: [],
};

export function actionsFor(platform: Platform | null): readonly DeviceActionId[] {
  return platform === null ? [] : PLATFORM_ACTIONS[platform];
}

/** A revoked device is gone; nothing can be queued for it and it cannot be revoked twice. */
export function deviceIsLive(device: CustomerDeviceDto): boolean {
  return device.status !== 'revoked';
}

/** Which devices a fleet-wide catalogue refresh would actually reach. */
export function refreshable(devices: readonly CustomerDeviceDto[]): CustomerDeviceDto[] {
  return devices.filter((device) => (
    deviceIsLive(device) && actionsFor(device.platform).includes('refresh_catalog')
  ));
}

/**
 * The end of a diagnostics-log window: a full day from now, less a minute.
 *
 * The hub refuses anything past 24 hours and compares against its own clock,
 * so asking for exactly a day from the browser's is a request that fails
 * whenever the two disagree by a second. The minute is the slack.
 */
export function logWindowEnd(now: number): number {
  return now + DAY - 60;
}

/**
 * Every fragment of the 客户 count sentence, and the predicate behind it.
 *
 * R4 lives here: the sentence and the table call `selectCustomers` with the
 * same id, so "4 位正常" and the rows you get by clicking it cannot disagree.
 */
export const CUSTOMER_FILTERS = ['all', 'ok', 'unreachable'] as const;

export type CustomerFilterId = (typeof CUSTOMER_FILTERS)[number];
export type CustomerFilter = CustomerFilterId | null;

/**
 * The fragment and the row say the same word about the same customer.
 *
 * The count used to read the `connected` flag on its own, which is a
 * different question from the one the health word answers: the word only says
 * 正常 when the client is connected *and* its heartbeat is fresh, so a client
 * that reported "connected" yesterday and has said nothing since counted in
 * the sentence while its own row read 离线. Production said 5 位在线 over a
 * table where no row agreed. The verdict the row is coloured by is the whole
 * predicate now, for both.
 */
function isWell(row: CustomerSummaryDto): boolean {
  return row.verdict === 'ok';
}

export function selectCustomers(
  rows: readonly CustomerSummaryDto[],
  filter: CustomerFilter,
): CustomerSummaryDto[] {
  if (filter === 'ok') return rows.filter(isWell);
  if (filter === 'unreachable') return rows.filter((row) => row.verdict === 'unreachable');
  return [...rows];
}

export function customerCounts(
  rows: readonly CustomerSummaryDto[],
): Record<CustomerFilterId, number> {
  return {
    all: selectCustomers(rows, 'all').length,
    ok: selectCustomers(rows, 'ok').length,
    unreachable: selectCustomers(rows, 'unreachable').length,
  };
}

/**
 * Whether the last three columns have anything in them anywhere.
 *
 * 服务使用, 最低版本 and 到期 come from three different places and on this
 * fleet none of them is filled in, so the table carried three columns of
 * dashes across the width the addresses needed. They hide as one group,
 * because a table with two of the three still has a column of nothing in it,
 * and they come back on their own the moment any row has an answer — the
 * condition is the data, not a flag somebody has to remember to flip.
 */
export function planWired(rows: readonly CustomerSummaryDto[]): boolean {
  return rows.some((row) => (
    row.services.length > 0 || row.minAppVersion !== null || row.expiresAt !== null
  ));
}

/**
 * Whether anybody in the fleet has a WeChat id yet.
 *
 * The same rule the last three columns follow, for the same reason: a fleet
 * where nobody has filled one in gets a column of dashes across the width the
 * addresses need. It is one column rather than three, and it comes back the
 * moment the first customer has a handle.
 */
export function wechatKnown(rows: readonly CustomerSummaryDto[]): boolean {
  return rows.some((row) => row.wechatId !== null && row.wechatId !== '');
}

/**
 * The five platforms, always all five, in the order the chips render.
 *
 * A platform nobody has shipped a client for shows 未发布 rather than 0 —
 * a zero there reads as "nobody upgraded" when the truth is "nothing exists",
 * which is the same mistake `AdoptionMatrixDto.released` exists to prevent on
 * the 客户端 page.
 */
export const PLATFORM_CHIPS: Platform[] = ['macos', 'windows', 'linux', 'android', 'ios'];

export function releasedPlatforms(rows: readonly CustomerSummaryDto[]): Set<Platform> {
  const seen = new Set<Platform>();
  for (const row of rows) for (const platform of row.platforms) seen.add(platform);
  return seen;
}

export function selectByPlatform(
  rows: readonly CustomerSummaryDto[],
  platform: Platform | null,
): CustomerSummaryDto[] {
  if (platform === null) return [...rows];
  return rows.filter((row) => row.platforms.includes(platform));
}

export function platformCounts(
  rows: readonly CustomerSummaryDto[],
): Record<Platform, number> {
  const out = {} as Record<Platform, number>;
  for (const platform of PLATFORM_CHIPS) out[platform] = selectByPlatform(rows, platform).length;
  return out;
}

/**
 * The version band a customer falls in, decided here rather than asked for.
 *
 * A cell of the 客户端 matrix links to this filter, and the two have to agree
 * (R4): the matrix is counted by the Worker over devices, this is counted in
 * the browser over the rows already on screen, and both run the same rules
 * from `releases.ts`. The figure a cell shows is users, which is what the
 * filtered list then holds.
 *
 * `minAppVersion` is the oldest version any of the customer's devices reports,
 * so a customer with one updated laptop and one forgotten desktop counts as
 * behind — which is the answer that matters when the question is "who will
 * break when the floor moves".
 */
export function selectByBucket(
  rows: readonly CustomerSummaryDto[],
  published: readonly string[],
  bucket: AdoptionBucket | null,
): CustomerSummaryDto[] {
  if (bucket === null) return [...rows];
  return rows.filter((row) => bucketFor(row.minAppVersion, published) === bucket);
}

export function bucketCounts(
  rows: readonly CustomerSummaryDto[],
  published: readonly string[],
): Record<AdoptionBucket, number> {
  const out = {} as Record<AdoptionBucket, number>;
  for (const bucket of ADOPTION_BUCKETS) out[bucket] = selectByBucket(rows, published, bucket).length;
  return out;
}

/* ------------------------------------------------------------- 客服草稿 */

/**
 * The most recent attempt that actually failed, out of the timeline.
 *
 * `lastFailure` on the summary row carries the same four facts, but the
 * timeline carries the event itself — which is what a draft has to quote if
 * every line in it is to trace back to a field somebody can check.
 */
export function lastFailedAttempt(
  events: readonly ConnectionEventDto[],
): ConnectionEventDto | null {
  let newest: ConnectionEventDto | null = null;
  for (const row of events) {
    if (!isFailure(row.kind)) continue;
    if (newest === null || row.atMs > newest.atMs) newest = row;
  }
  return newest;
}

/** The public incident on the machine this attempt was made against, if there is one. */
export function publicIncidentOn(
  incidents: readonly IncidentDto[],
  node: string | null,
): IncidentDto | null {
  if (node === null) return null;
  return incidents.find((row) => (
    row.status !== 'resolved' && row.subjectType === 'node' && row.subjectId === node
  )) ?? null;
}

/**
 * A machine to send the customer to instead.
 *
 * Only the engine's own verdict decides: a node it still calls 正常, listed in
 * the catalogue, and not the one that just failed. A suggestion made from
 * anything softer than that is the console inventing a recovery promise.
 */
export function spareNode(
  nodes: readonly NodeSummaryDto[],
  avoid: string | null,
): string | null {
  const usable = nodes.filter((row) => (
    row.verdict === 'ok' && row.lifecycle === 'listed' && row.name !== avoid
  ));
  return usable[0]?.name ?? null;
}

/** The question worth asking back, chosen by the code the client reported. */
function questionFor(code: string | null): string {
  const asks = copy.replyQuestion as Record<string, string>;
  const key = (code ?? '').toUpperCase();
  return asks[key] ?? copy.replyQuestion.other;
}

/**
 * The reply, assembled from fields and nothing else.
 *
 * Six lines, each one traceable: when the attempt was and against which
 * machine, where in the attempt it fell over and what the client called it,
 * whether an incident is already open on that machine, which machine to try
 * instead, and the one question the operator needs answered to get any
 * further. Nothing here names a cause — 被墙, 限速, 运营商 — because no field
 * on this page measures one, and a sentence a customer can quote back has to
 * be a sentence the console can stand behind.
 */
export function replyDraft(input: {
  who: string;
  failure: ConnectionEventDto;
  incident: IncidentDto | null;
  spare: string | null;
}): string {
  const { who, failure, incident, spare } = input;
  const said = copy.replyLine;
  const at = formatWhen(Math.floor(failure.atMs / 1_000));
  const lines = [
    said.greeting(who),
    failure.node === null ? said.attemptNoNode(at) : said.attempt(at, failure.node),
  ];
  const stage = stageWord(failure.stage);
  const why = explainCode(failure.code);
  if (stage !== null && why !== null) {
    lines.push(failure.code === null
      ? said.stage(stage, why)
      : said.stageCode(stage, failure.code, why));
  }
  lines.push(incident === null ? said.incidentNo : said.incidentYes(incident.title));
  lines.push(spare === null ? said.alternativeNone : said.alternative(spare));
  lines.push(said.question(questionFor(failure.code)));
  return lines.join('\n');
}

/**
 * The newest thing still owed on each customer.
 *
 * The 客户 list's 跟进 column shows one row per person, and the one worth
 * showing is the most recent one nobody has finished: an 等客户验证 from this
 * morning says more about what to do next than a 已回复 from last week. Done
 * followups are left out — the column is a list of what is outstanding, not a
 * history, and the history is on the customer's own page.
 */
export function newestOpenFollowups(
  rows: readonly FollowupDto[],
): Map<string, FollowupDto> {
  const out = new Map<string, FollowupDto>();
  for (const row of rows) {
    if (row.subjectType !== 'user' || row.doneAt !== null) continue;
    const seen = out.get(row.subjectId);
    if (seen === undefined || row.createdAt > seen.createdAt) out.set(row.subjectId, row);
  }
  return out;
}
