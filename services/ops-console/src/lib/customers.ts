import type { CustomerSummaryDto, Platform } from '@contract';

/**
 * Every fragment of the 客户 count sentence, and the predicate behind it.
 *
 * R4 lives here: the sentence and the table call `selectCustomers` with the
 * same id, so "4 位在线" and the rows you get by clicking it cannot disagree.
 */
export const CUSTOMER_FILTERS = ['all', 'online', 'unreachable'] as const;

export type CustomerFilterId = (typeof CUSTOMER_FILTERS)[number];
export type CustomerFilter = CustomerFilterId | null;

/**
 * Online means measured online. A customer whose client has never reported
 * has `asOfSec === null`, and counting that as "not online" would be a claim
 * nobody measured — it belongs to 未上报, which is a health word, not a count.
 */
function isOnline(row: CustomerSummaryDto): boolean {
  return row.connected.value === true && row.connected.asOfSec !== null;
}

export function selectCustomers(
  rows: readonly CustomerSummaryDto[],
  filter: CustomerFilter,
): CustomerSummaryDto[] {
  if (filter === 'online') return rows.filter(isOnline);
  if (filter === 'unreachable') return rows.filter((row) => row.verdict === 'unreachable');
  return [...rows];
}

export function customerCounts(
  rows: readonly CustomerSummaryDto[],
): Record<CustomerFilterId, number> {
  return {
    all: selectCustomers(rows, 'all').length,
    online: selectCustomers(rows, 'online').length,
    unreachable: selectCustomers(rows, 'unreachable').length,
  };
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
