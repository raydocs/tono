import type { NodeSummaryDto } from '@contract';
import { columns, derive, type Derived, type FleetLoadWindow, type LoadPoint } from './node-legacy';

/**
 * The collector's window for the whole fleet, folded into what the 节点 page
 * draws: the fleet's mean and its busiest machine for the three shares, the
 * fleet's total for traffic, and each machine's own CPU line for its row.
 *
 * Every column is computed over the machines that reported in it. A machine
 * that was silent adds nothing to a mean or a total rather than a zero, and a
 * column where no machine reported is a gap in every line (R2). That makes the
 * total a floor on a column where some machines were silent — the panel says
 * so in its description rather than guessing what they would have said.
 */
export type FleetLoad = {
  cpu: { mean: LoadPoint[]; max: LoadPoint[] };
  memory: { mean: LoadPoint[]; max: LoadPoint[] };
  load1: { mean: LoadPoint[]; max: LoadPoint[] };
  netIn: LoadPoint[];
  netOut: LoadPoint[];
  perNode: Map<string, NodeLoadRow>;
  /** How many machines reported anything at all in the window. */
  reporting: number;
  asOfSec: number | null;
};

export type NodeLoadRow = {
  cpu: LoadPoint[];
  /** The newest measured column, not the newest raw sample: a lone sample is noise. */
  cpuNow: number | null;
  memoryNow: number | null;
};

type Pick = (row: Derived) => number | null;

function across(
  lines: readonly LoadPoint[][],
  reduce: (values: number[]) => number,
): LoadPoint[] {
  const head = lines[0];
  if (head === undefined) return [];
  return head.map((point, slot) => {
    const values = lines.map((line) => line[slot]?.v ?? null).filter((v): v is number => v !== null);
    return { t: point.t, v: values.length === 0 ? null : reduce(values) };
  });
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const max = (values: number[]) => Math.max(...values);
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

function last(points: readonly LoadPoint[]): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point !== undefined && point.v !== null) return point.v;
  }
  return null;
}

export function foldFleetLoad(window: FleetLoadWindow): FleetLoad {
  let newest: number | null = null;
  let earliest = window.from;
  for (const samples of window.series.values()) {
    const first = samples[0];
    const latest = samples[samples.length - 1];
    if (first === undefined || latest === undefined) continue;
    earliest = Math.min(earliest, first.t);
    newest = Math.max(newest ?? 0, latest.t);
  }
  const from = earliest;
  const to = Math.max(window.to, newest ?? window.to);

  const derived = [...window.series].filter(([, samples]) => samples.length > 0)
    .map(([name, samples]) => [name, derive(samples)] as const);
  const lines = (pick: Pick) => derived.map(([, rows]) => columns(rows, pick, from, to));

  const cpu = lines((row) => row.cpu);
  const memory = lines((row) => row.memory);
  const load1 = lines((row) => row.load1);
  const perNode = new Map<string, NodeLoadRow>();
  derived.forEach(([name], index) => {
    const cpuLine = cpu[index];
    const memoryLine = memory[index];
    if (cpuLine === undefined || memoryLine === undefined) return;
    perNode.set(name, { cpu: cpuLine, cpuNow: last(cpuLine), memoryNow: last(memoryLine) });
  });

  return {
    cpu: { mean: across(cpu, mean), max: across(cpu, max) },
    memory: { mean: across(memory, mean), max: across(memory, max) },
    load1: { mean: across(load1, mean), max: across(load1, max) },
    netIn: across(lines((row) => row.netIn), sum),
    netOut: across(lines((row) => row.netOut), sum),
    perNode,
    reporting: derived.length,
    asOfSec: newest,
  };
}

/** Did any machine's load line have two columns to draw between? */
export function hasFleetLoad(load: FleetLoad): boolean {
  return load.cpu.mean.filter((point) => point.v !== null).length >= 2;
}

/** The second block on a node, folded onto its base name (control-plane `HY2_NAME_SUFFIX`). */
const HY2_NAME_SUFFIX = ' · hy2';

/** Mirror of control-plane `catalogBaseName`: strips ` · hy2` and nothing else. */
function baseName(name: string): string {
  return name.endsWith(HY2_NAME_SUFFIX) ? name.slice(0, -HY2_NAME_SUFFIX.length) : name;
}

export type ReportingBreakdown = {
  /** Series keys that reported anything: the number the band says. */
  reporting: number;
  /** Of those, keys that belong to a retired machine. */
  retired: number;
  /** Of those, keys that match no machine in the node list. */
  unknown: number;
  /** Keys that match a machine, retired or not. */
  matched: number;
  /** In-service machines that no key matches. */
  silent: number;
};

/**
 * Why the band's count and the page's 在役 differ. The metrics read has no
 * catalog join, so a key is a raw node name: it may belong to a retired
 * machine whose agent still runs, or to a name the node list never had.
 */
export function reportingBreakdown(
  keys: Iterable<string>,
  nodes: readonly { name: string; lifecycle: NodeSummaryDto['lifecycle'] }[],
): ReportingBreakdown {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const seen = new Set<string>();
  let reporting = 0;
  let retired = 0;
  let matched = 0;
  for (const key of keys) {
    reporting += 1;
    const node = byName.get(key) ?? byName.get(baseName(key));
    if (node === undefined) continue;
    matched += 1;
    seen.add(node.name);
    if (node.lifecycle === 'retired') retired += 1;
  }
  const silent = nodes.filter((node) => node.lifecycle !== 'retired' && !seen.has(node.name)).length;
  return { reporting, retired, unknown: reporting - matched, matched, silent };
}
