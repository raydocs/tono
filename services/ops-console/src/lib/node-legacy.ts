import { getJson } from './api';
import { copy } from '@/copy/copy';

/**
 * The two 节点详情 reads that predate the typed contract.
 *
 * `metrics` and `fleet-nodes/{name}/quality-text` are the endpoints the old
 * console's node drawer drew its trend charts and its port/backtrace fold
 * from. They answer bare objects rather than the list envelope, so — like
 * `settings-legacy.ts` — this file keeps a hand-written shape per response and
 * a guard that refuses anything else, instead of widening `contract.ts` for
 * two surfaces that are about to be their only caller.
 *
 * The reads go through `api.ts` rather than carrying their own fetch, because
 * neither of them has to tell a 409 from a 400: a load chart that failed is a
 * sentence, not a branch.
 */

export const NODE_LOAD_RANGES = ['24h', '7d'] as const;
export type NodeLoadRange = (typeof NODE_LOAD_RANGES)[number];

/**
 * The six columns the section draws, asked for by name.
 *
 * The endpoint hands back every metric it stores when nothing is named, which
 * on a 24-hour window is ten columns of a thousand-odd rows for four charts
 * and two facts. Naming them keeps the response to what is on screen.
 */
const FIELDS = 'cpu,memUsed,memTotal,netIn,netOut,tcpConnections';

/**
 * One sample as the collector recorded it.
 *
 * `netIn` / `netOut` are the machine's lifetime byte counters, not a rate:
 * they only ever climb, and they start again from zero when the box reboots.
 * Nothing here interprets them — `foldLoad` does, and that is the one place
 * that knows a step backwards is a restart rather than negative traffic.
 */
export type LoadSample = {
  t: number;
  cpu: number | null;
  memUsed: number | null;
  memTotal: number | null;
  netIn: number | null;
  netOut: number | null;
  tcpConnections: number | null;
};

export type NodeLoadWindow = {
  from: number;
  to: number;
  resolutionSeconds: number;
  samples: LoadSample[];
};

/** The raw sweep for one machine: what the ports look like, and the backtrace. */
export type NodeQualityText = {
  securityCheck: string | null;
  backtrace: string | null;
};

/* --------------------------------------------------------------- guards */

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(copy.loadError);
  }
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(copy.loadError);
  return value;
}

function maybeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function maybeText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readSample(value: unknown): LoadSample {
  const row = record(value);
  return {
    t: count(row.t),
    cpu: maybeCount(row.cpu),
    memUsed: maybeCount(row.memUsed),
    memTotal: maybeCount(row.memTotal),
    netIn: maybeCount(row.netIn),
    netOut: maybeCount(row.netOut),
    tcpConnections: maybeCount(row.tcpConnections),
  };
}

/**
 * The window, with one machine's rows lifted out of the per-node map.
 *
 * The request names the node, so the map has at most one key — but it is
 * keyed by the collector's name for the machine, and a node whose catalogue
 * name and collector name have ever disagreed would silently draw nothing.
 * The exact name wins; a single unnamed series is taken as this machine's.
 */
function readWindow(value: unknown, name: string): NodeLoadWindow {
  const body = record(record(value).metrics);
  const series = record(body.series);
  const keys = Object.keys(series);
  const key = Object.prototype.hasOwnProperty.call(series, name)
    ? name
    : keys.length === 1 ? keys[0] : null;
  const rows = key === null ? [] : series[key];
  return {
    from: count(body.from),
    to: count(body.to),
    resolutionSeconds: count(body.resolutionSeconds),
    samples: (Array.isArray(rows) ? rows : []).map(readSample).sort((a, b) => a.t - b.t),
  };
}

function readQualityText(value: unknown): NodeQualityText {
  const row = record(value);
  return {
    securityCheck: maybeText(row.securityCheck),
    backtrace: maybeText(row.backtrace),
  };
}

export const nodeLegacyApi = {
  load: async (name: string, range: NodeLoadRange, signal?: AbortSignal) =>
    readWindow(
      await getJson<unknown>('metrics', signal, { range, node: name, fields: FIELDS }),
      name,
    ),
  qualityText: async (name: string, signal?: AbortSignal) =>
    readQualityText(
      await getJson<unknown>(`fleet-nodes/${encodeURIComponent(name)}/quality-text`, signal),
    ),
};

/* ------------------------------------------------- samples to four shapes */

/** One column of a chart. `null` is a stretch nobody measured, not a zero. */
export type LoadPoint = { t: number; v: number | null };

export type LoadCharts = {
  /** Per cent of the machine, 0–100, as the agent reports it. */
  cpu: LoadPoint[];
  memory: LoadPoint[];
  /** Bytes per second, worked out from the counters between two samples. */
  netIn: LoadPoint[];
  netOut: LoadPoint[];
  /**
   * The 95th percentile of in+out, which is how transit is billed — the
   * number an operator compares against what they are paying for.
   */
  bandwidth95: number | null;
  peakConnections: number | null;
  /** When the newest sample in the window was taken, or null for an empty one. */
  asOfSec: number | null;
};

/** How many columns a chart is drawn with, whatever the window's own cadence. */
const COLUMNS = 96;

const P95 = 0.95;

type Derived = {
  t: number;
  cpu: number | null;
  memory: number | null;
  netIn: number | null;
  netOut: number | null;
  total: number | null;
};

/**
 * A counter pair turned into a rate, or nothing.
 *
 * Three cases end as nothing rather than as a number: a missing reading on
 * either side, two samples with no time between them, and a counter that went
 * backwards. The last one is a reboot — the machine started counting again —
 * and drawing `(small - large) / dt` there would put a deep negative spike on
 * the chart every time a node was restarted.
 */
function ratePerSecond(before: number | null, after: number | null, seconds: number): number | null {
  if (before === null || after === null || seconds <= 0) return null;
  const delta = after - before;
  return delta < 0 ? null : delta / seconds;
}

function derive(samples: readonly LoadSample[]): Derived[] {
  const out: Derived[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const row = samples[index];
    const previous = index === 0 ? null : samples[index - 1];
    const seconds = previous === null ? 0 : row.t - previous.t;
    const netIn = previous === null ? null : ratePerSecond(previous.netIn, row.netIn, seconds);
    const netOut = previous === null ? null : ratePerSecond(previous.netOut, row.netOut, seconds);
    const share = row.memUsed !== null && row.memTotal !== null && row.memTotal > 0
      ? (row.memUsed / row.memTotal) * 100
      : null;
    out.push({
      t: row.t,
      cpu: row.cpu,
      memory: share,
      netIn,
      netOut,
      total: netIn === null || netOut === null ? null : netIn + netOut,
    });
  }
  return out;
}

/**
 * Fixed columns rather than one per sample.
 *
 * A day of per-minute samples is fourteen hundred points in a chart four
 * centimetres wide, which is a smear; a week of half-hourly buckets is three
 * hundred. Both are drawn with the same number of columns so the two ranges
 * read as the same picture at two zooms, and a column nobody measured stays
 * empty instead of being joined across.
 */
function columns(
  rows: readonly Derived[],
  pick: (row: Derived) => number | null,
  from: number,
  to: number,
): LoadPoint[] {
  const span = Math.max(1, to - from);
  const width = span / COLUMNS;
  const sums = new Array<number>(COLUMNS).fill(0);
  const seen = new Array<number>(COLUMNS).fill(0);
  for (const row of rows) {
    const value = pick(row);
    if (value === null) continue;
    const slot = Math.min(COLUMNS - 1, Math.max(0, Math.floor((row.t - from) / width)));
    sums[slot] += value;
    seen[slot] += 1;
  }
  return sums.map((sum, slot) => ({
    t: Math.round(from + (slot + 0.5) * width),
    v: seen[slot] === 0 ? null : sum / seen[slot],
  }));
}

/** The value at the 95th percentile, or nothing when too little was measured. */
function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * P95) - 1));
  return sorted[at];
}

export function foldLoad(taken: NodeLoadWindow): LoadCharts {
  const rows = derive(taken.samples);
  const last = taken.samples.length === 0 ? null : taken.samples[taken.samples.length - 1].t;
  const totals = rows.map((row) => row.total).filter((row): row is number => row !== null);
  const peaks = taken.samples
    .map((row) => row.tcpConnections)
    .filter((row): row is number => row !== null);
  const from = taken.samples.length === 0 ? taken.from : Math.min(taken.from, taken.samples[0].t);
  const to = Math.max(taken.to, last ?? taken.to);
  return {
    cpu: columns(rows, (row) => row.cpu, from, to),
    memory: columns(rows, (row) => row.memory, from, to),
    netIn: columns(rows, (row) => row.netIn, from, to),
    netOut: columns(rows, (row) => row.netOut, from, to),
    bandwidth95: percentile95(totals),
    peakConnections: peaks.length === 0 ? null : Math.max(...peaks),
    asOfSec: last,
  };
}

/** Did anything at all get measured in this window? */
export function hasLoad(charts: LoadCharts): boolean {
  return charts.asOfSec !== null;
}
