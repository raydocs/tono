import type { AdoptionBucket, CustomerSummaryDto, Platform } from '@contract';
import { ADOPTION_BUCKETS } from '@contract';
import { bucketFor } from './releases';

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
