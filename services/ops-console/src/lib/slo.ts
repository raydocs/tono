import type { SloRowDto } from './api-slo';

/**
 * The daily quality rows, folded into what the charts draw.
 *
 * Every rate here is Σ successes / Σ attempts over the slices it covers, never
 * an average of rates: a node with 12 attempts at 50 % and one with 4 000 at
 * 99 % are not a 74.5 % fleet. Outage and unmeasured minutes are facts about
 * a node-day and repeat on every platform × carrier slice of it, so they are
 * counted once per node-day — the rule `handlers/slo.ts` uses for the
 * summary, so a chart and the number above it cannot disagree (R4).
 */

export type DayPoint = { t: number; v: number | null };

export function daysOf(items: readonly SloRowDto[]): number[] {
  return [...new Set(items.map((row) => row.dayAt))].sort((a, b) => a - b);
}

/**
 * Success rate per day for each value of `keyOf`. A day on which a key made
 * no attempts is a gap in that key's line, not a 0 % and not a 100 %.
 */
export function dailyRate(
  items: readonly SloRowDto[],
  keyOf: (row: SloRowDto) => string,
): Map<string, DayPoint[]> {
  const days = daysOf(items);
  const sums = new Map<string, Map<number, { attempts: number; successes: number }>>();
  for (const row of items) {
    const key = keyOf(row);
    const byDay = sums.get(key) ?? new Map();
    const cell = byDay.get(row.dayAt) ?? { attempts: 0, successes: 0 };
    cell.attempts += row.attempts;
    cell.successes += row.successes;
    byDay.set(row.dayAt, cell);
    sums.set(key, byDay);
  }
  const out = new Map<string, DayPoint[]>();
  for (const [key, byDay] of sums) {
    out.set(key, days.map((t) => {
      const cell = byDay.get(t);
      return { t, v: cell && cell.attempts > 0 ? cell.successes / cell.attempts : null };
    }));
  }
  return out;
}

/** Attempts per day, one number per value of `keyOf`, in the order given. */
export function dailyAttempts(
  items: readonly SloRowDto[],
  keys: readonly string[],
  keyOf: (row: SloRowDto) => string,
): Array<{ dayAt: number; values: Array<number | null> }> {
  return daysOf(items).map((dayAt) => {
    const rows = items.filter((row) => row.dayAt === dayAt);
    return {
      dayAt,
      values: keys.map((key) => {
        const hits = rows.filter((row) => keyOf(row) === key);
        return hits.length === 0 ? null : hits.reduce((sum, row) => sum + row.attempts, 0);
      }),
    };
  });
}

/** Verified outage minutes per day across the fleet, one count per node-day. */
export function dailyOutage(items: readonly SloRowDto[]): Array<{ dayAt: number; minutes: number }> {
  const seen = new Map<string, number>();
  for (const row of items) {
    const key = `${row.dayAt}:${row.node}`;
    if (!seen.has(key)) seen.set(key, row.verifiedOutageMin);
  }
  return daysOf(items).map((dayAt) => ({
    dayAt,
    minutes: [...seen].reduce((sum, [key, min]) => (key.startsWith(`${dayAt}:`) ? sum + min : sum), 0),
  }));
}

export type NodeQuality = {
  node: string;
  attempts: number;
  successes: number;
  rate: number | null;
  outageMin: number;
  unmeasuredMin: number;
  /** Median of the slice medians, the same estimate the summary prints. */
  p50Ms: number | null;
  days: DayPoint[];
};

/** One row per node, worst success rate first; nodes with no attempts go last. */
export function nodeQuality(items: readonly SloRowDto[]): NodeQuality[] {
  const rates = dailyRate(items, (row) => row.node);
  const byNode = new Map<string, SloRowDto[]>();
  for (const row of items) byNode.set(row.node, [...(byNode.get(row.node) ?? []), row]);
  const rows: NodeQuality[] = [];
  for (const [node, list] of byNode) {
    const attempts = list.reduce((sum, row) => sum + row.attempts, 0);
    const successes = list.reduce((sum, row) => sum + row.successes, 0);
    const perDay = new Map<number, SloRowDto>();
    for (const row of list) if (!perDay.has(row.dayAt)) perDay.set(row.dayAt, row);
    const p50s = list.map((row) => row.p50Ms).filter((v): v is number => v !== null).sort((a, b) => a - b);
    rows.push({
      node,
      attempts,
      successes,
      rate: attempts > 0 ? successes / attempts : null,
      outageMin: [...perDay.values()].reduce((sum, row) => sum + row.verifiedOutageMin, 0),
      unmeasuredMin: [...perDay.values()].reduce((sum, row) => sum + row.unmeasuredMin, 0),
      p50Ms: p50s.length > 0 ? p50s[Math.floor((p50s.length - 1) / 2)] : null,
      days: rates.get(node) ?? [],
    });
  }
  return rows.sort((a, b) => (a.rate ?? 2) - (b.rate ?? 2) || a.node.localeCompare(b.node));
}

/**
 * The value axis for success rates: from the nearest 5 % below the worst day
 * up to 100 %. Starting at 0 would press a month of 97–99 % into one line
 * along the top; starting at the minimum would turn a 0.3 % wobble into a cliff.
 */
export function rateDomain(series: Iterable<readonly DayPoint[]>): [number, number] {
  let lo = 1;
  for (const points of series) for (const point of points) if (point.v !== null) lo = Math.min(lo, point.v);
  return [Math.max(0, Math.floor(lo * 20 - 1e-9) / 20), 1];
}

/** Each key's share of attempts, largest first, for ordering series and stacks. */
export function keysByAttempts(items: readonly SloRowDto[], keyOf: (row: SloRowDto) => string): string[] {
  const totals = new Map<string, number>();
  for (const row of items) totals.set(keyOf(row), (totals.get(keyOf(row)) ?? 0) + row.attempts);
  return [...totals].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}
