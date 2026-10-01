import { nowSec } from '../../src/lib/clock';

/**
 * `GET /slo` for the fixture server: thirty days of daily rows per node,
 * platform and carrier, in the shape `contract/slo.ts` checks.
 *
 * The numbers are generated rather than committed because a month of rows for
 * six nodes is 1 000 lines of JSON nobody would review. The generator is
 * deterministic — the same fake clock gives the same rows — and it tells one
 * story the pages have to be able to show: Los Angeles · Mesa is blocked for
 * the last two days on 电信 and 联通, Singapore mobile is lossy all month, and
 * Seoul stopped reporting for a day, which is a gap and not a zero.
 */
const DAY = 86_400;
const NODES = [
  'Tokyo · Fuji',
  'Tokyo · Neon',
  'Los Angeles · Mesa',
  'Hong Kong · Victoria',
  'Seoul · Han',
  'Singapore · Harbour（新加坡海港 · 大陆直连 · CMIN2）',
];
const PLATFORMS = ['macos', 'windows'] as const;
const CARRIERS = ['telecom', 'unicom', 'mobile'] as const;

type Row = {
  dayAt: number;
  platform: string;
  carrier: string;
  node: string;
  attempts: number;
  successes: number;
  p50Ms: number | null;
  verifiedOutageMin: number;
  unmeasuredMin: number;
  rulesVersion: number;
};

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

function rowFor(dayIndex: number, dayAt: number, node: string, n: number, platform: string, p: number, carrier: string, c: number): Row | null {
  const seed = dayIndex * 97 + n * 31 + p * 7 + c * 3;
  if (node === 'Seoul · Han' && dayIndex === 9) return null;
  const attempts = Math.round((platform === 'windows' ? 90 : 130) * (0.7 + 0.6 * noise(seed)) * (c === 2 ? 0.7 : 1));
  let rate = 0.992 - (platform === 'windows' ? 0.006 : 0) - 0.01 * noise(seed + 1);
  const blocked = node === 'Los Angeles · Mesa' && dayIndex < 2;
  if (blocked && carrier !== 'mobile') rate = 0.38 + 0.1 * noise(seed + 2);
  // Outage and unmeasured minutes are facts about a node-day, so every slice
  // of that node-day carries the same number, as `ops_daily_slo` does.
  const outage = blocked ? (dayIndex === 0 ? 540 : 1_440) : 0;
  const unmeasured = noise(dayIndex * 97 + n * 31 + 5) > 0.9 ? 30 : 0;
  if (node.startsWith('Singapore') && carrier === 'mobile') rate -= 0.035 + 0.02 * noise(seed + 3);
  const base = node.startsWith('Tokyo') ? 48 : node.startsWith('Hong Kong') ? 36 : node.startsWith('Seoul') ? 58 : 150;
  return {
    dayAt,
    platform,
    carrier,
    node,
    attempts,
    successes: Math.round(attempts * Math.max(0, Math.min(1, rate))),
    p50Ms: Math.round(base * (0.85 + 0.3 * noise(seed + 4)) + (c === 2 ? 20 : 0)),
    verifiedOutageMin: outage,
    unmeasuredMin: unmeasured,
    rulesVersion: 2,
  };
}

export function sloBody(query: URLSearchParams, empty: boolean) {
  const now = nowSec();
  const today = Math.floor(now / DAY) * DAY;
  const days = query.get('range') === '7d' ? 7 : 30;
  const items: Row[] = [];
  if (!empty) {
    for (let d = days; d >= 1; d -= 1) {
      NODES.forEach((node, n) => PLATFORMS.forEach((platform, p) => CARRIERS.forEach((carrier, c) => {
        const row = rowFor(d - 1, today - d * DAY, node, n, platform, p, carrier, c);
        if (row) items.push(row);
      })));
    }
  }
  const filtered = items.filter((row) => (
    (!query.get('node') || row.node === query.get('node'))
    && (!query.get('platform') || row.platform === query.get('platform'))
    && (!query.get('carrier') || row.carrier === query.get('carrier'))
  ));
  // The summary is computed the way `src/ops/handlers/slo.ts` computes it.
  const attempts = filtered.reduce((sum, row) => sum + row.attempts, 0);
  const successes = filtered.reduce((sum, row) => sum + row.successes, 0);
  const p50s = filtered.map((row) => row.p50Ms).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const outage = new Map<string, number>();
  const unmeasured = new Map<string, number>();
  for (const row of filtered) {
    const key = `${row.dayAt}:${row.node}`;
    if (!outage.has(key)) outage.set(key, row.verifiedOutageMin);
    if (!unmeasured.has(key)) unmeasured.set(key, row.unmeasuredMin);
  }
  const unmeasuredMin = [...unmeasured.values()].reduce((sum, m) => sum + m, 0);
  const tracked = unmeasured.size * 1_440;
  return {
    items: filtered,
    summary: {
      successRate: attempts > 0 ? Number((successes / attempts).toFixed(4)) : null,
      p50Ms: p50s.length > 0 ? p50s[Math.floor((p50s.length - 1) / 2)] : null,
      verifiedOutageMin: [...outage.values()].reduce((sum, m) => sum + m, 0),
      unmeasuredMin,
      coverage: tracked > 0 ? Number((Math.max(0, tracked - unmeasuredMin) / tracked).toFixed(4)) : 1,
    },
    nextCursor: null,
    total: filtered.length,
    updatedAt: now - 240,
  };
}
