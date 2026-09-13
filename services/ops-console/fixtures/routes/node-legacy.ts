/**
 * The two 节点详情 reads that predate the typed contract, served by the
 * fixture dev server: `metrics` and `fleet-nodes/{name}/quality-text`.
 *
 * The samples are generated rather than committed, for one reason the other
 * fixtures do not have: a day at the collector's cadence is 288 rows of ten
 * columns, and a committed copy of that is a 200 KB file nobody can review
 * and that says nothing a reader could check. What is worth reviewing is the
 * *shape* — a working day with an evening peak, one machine restart, and one
 * stretch nobody measured — so that is what is written here, deterministically
 * from the node's own name, and the numbers fall out of it.
 *
 * Deterministic matters twice over: the screenshot baselines are captured
 * against a frozen clock, and a chart drawn from `Math.random()` would make
 * every one of them flake.
 */

const HOUR = 3_600;
const DAY = 24 * HOUR;
const GIB = 1_073_741_824;

/** 24 小时 at five minutes a sample is 288 points; 7 天 at half an hour is 336. */
const WINDOWS: Record<string, { span: number; step: number }> = {
  '24h': { span: DAY, step: 300 },
  '7d': { span: 7 * DAY, step: 1_800 },
};

type Point = Record<string, number | null> & { t: number };

/** A pseudo-random stream that is the same every run for the same seed. */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function seedOf(text: string): number {
  let seed = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    seed = Math.imul(seed ^ text.charCodeAt(index), 16_777_619);
  }
  return seed >>> 0;
}

/**
 * Where in the working day this sample sits, 0 at the quiet hour and 1 at the
 * evening peak. Without it every chart is a flat band of noise, which is the
 * one shape that proves nothing about whether the chart works.
 */
function diurnal(at: number): number {
  const hour = ((at % DAY) + DAY) % DAY / HOUR;
  return (1 - Math.cos(((hour - 4) / 24) * 2 * Math.PI)) / 2;
}

/**
 * One machine's day.
 *
 * Two deliberate discontinuities, both of which the console has to draw
 * honestly rather than smoothly: a reboot a third of the way in, where the
 * byte counters start again from nothing, and forty minutes in the middle
 * where nothing was reported at all.
 */
function samplesFor(name: string, from: number, to: number, step: number): Point[] {
  const random = stream(seedOf(name));
  const total = Math.floor((to - from) / step);
  const rebootAt = from + Math.floor(total / 3) * step;
  const silentFrom = from + Math.floor(total * 0.6) * step;
  const silentTo = silentFrom + 8 * step;
  const memTotal = 2 * GIB;
  let netIn = 41_000_000_000 + Math.floor(random() * 9_000_000_000);
  let netOut = 7_000_000_000 + Math.floor(random() * 2_000_000_000);
  const rows: Point[] = [];

  for (let index = 0; index < total; index += 1) {
    const at = from + index * step;
    const busy = diurnal(at);
    const jitter = random();
    // The counters keep climbing whether or not anything was reported; only
    // the reboot puts them back, and that is the case the chart must break on.
    const inRate = 900_000 + busy * 5_600_000 + jitter * 700_000;
    const outRate = 220_000 + busy * 1_500_000 + jitter * 180_000;
    if (at === rebootAt) {
      netIn = Math.floor(inRate * 30);
      netOut = Math.floor(outRate * 30);
    } else {
      netIn += Math.floor(inRate * step);
      netOut += Math.floor(outRate * step);
    }
    if (at >= silentFrom && at < silentTo) continue;
    rows.push({
      t: at,
      cpu: Math.round((7 + busy * 46 + jitter * 9) * 10) / 10,
      memUsed: Math.round(memTotal * (0.51 + busy * 0.21 + jitter * 0.04)),
      memTotal,
      netIn,
      netOut,
      tcpConnections: Math.round(18 + busy * 118 + jitter * 14),
    });
  }
  return rows;
}

const ALL_FIELDS = ['cpu', 'memUsed', 'memTotal', 'netIn', 'netOut', 'tcpConnections'] as const;

function only(row: Point, fields: string[]): Point {
  const out: Point = { t: row.t };
  for (const field of fields) out[field] = row[field] ?? null;
  return out;
}

/**
 * `GET metrics`, for one node or for the whole fleet.
 *
 * The empty set answers a window with no series in it rather than a 404: a
 * machine the collector has never seen is the case the empty sentence exists
 * for, and a failed request would say something else entirely.
 */
export function metricsBody(options: {
  name: string | null;
  range: string | null;
  fields: string | null;
  empty: boolean;
  nowUnix: number;
}): unknown {
  const shape = WINDOWS[options.range ?? '24h'] ?? WINDOWS['24h'];
  const to = Math.floor(options.nowUnix / shape.step) * shape.step;
  const from = to - shape.span;
  const asked = (options.fields ?? '').split(',').map((field) => field.trim()).filter(Boolean);
  const fields = asked.length > 0
    ? asked.filter((field) => (ALL_FIELDS as readonly string[]).includes(field))
    : [...ALL_FIELDS];
  const series: Record<string, Point[]> = {};
  if (!options.empty && options.name) {
    series[options.name] = samplesFor(options.name, from, to, shape.step)
      .map((row) => only(row, fields));
  }
  return { metrics: { from, to, resolutionSeconds: shape.step, series } };
}

/**
 * `GET fleet-nodes/{name}/quality-text`.
 *
 * Two bodies in the machine's own words, kept short enough to read in a review
 * and long enough to overflow the fold's own height — the block scrolls, and a
 * three-line sample would never prove that it does.
 */
export function qualityTextBody(name: string, empty: boolean): unknown {
  if (empty) return { securityCheck: null, backtrace: null };
  return {
    securityCheck: [
      `# security sweep — ${name}`,
      'listening ports (nmap -sT, 2026-09-08 22:14 UTC)',
      '  22/tcp   open  ssh      OpenSSH 9.2p1 Debian-2+deb12u3',
      '  443/tcp  open  https    xray/vless-reality',
      '  8080/tcp open  http-alt nginx 1.22.1        <- unexpected, not in catalog',
      '  9100/tcp open  exporter node_exporter 1.7.0 <- acknowledged 2026-06-01',
      '',
      'risk signals',
      '  password auth  disabled',
      '  root login     prohibit-password',
      '  fail2ban       active, 3 bans in the last 24h',
      '  outbound smtp  blocked by provider',
      '',
      'notes',
      '  8080 answers the default nginx page; nothing in the catalog points at it.',
      '  Close it or acknowledge it before the next sweep.',
    ].join('\n'),
    backtrace: [
      `# mainland backtrace — ${name}`,
      'unicom  (AS4837)',
      '   1  10.0.0.1              0.4 ms',
      '   6  219.158.16.x          38.2 ms  cn2-gia handoff',
      '   9  113.108.208.x        186.4 ms  loss 4.2%',
      '  12  destination          214.7 ms  loss 4.6%',
      '',
      'telecom (AS4809)',
      '   1  10.0.0.1              0.4 ms',
      '   7  202.97.12.x           74.1 ms',
      '  11  destination          101.3 ms  loss 0.2%',
      '',
      'mobile  (AS9808)',
      '   1  10.0.0.1              0.4 ms',
      '   8  221.183.x.x           88.9 ms',
      '  12  destination          143.6 ms  loss 1.1%',
      '',
      'verdict: unicom return path is the weak leg; telecom and mobile are clean.',
    ].join('\n'),
  };
}
