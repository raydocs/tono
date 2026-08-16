import type { CarrierKey, CarrierPingDto, CarrierPingMapDto } from '../api';

/**
 * Turning per-carrier ping into something readable, and refusing to turn
 * absence into a reading.
 *
 * Two things this deliberately does not do:
 *
 *   * it does not invent a row for a carrier with no samples — the row says
 *     未探测, because a node nobody has probed must not look like a good one;
 *   * it does not claim the three numbers are strictly comparable. 联通 answers
 *     ICMP from northern cities only, so its targets sit further from the
 *     southern ones 电信 and 移动 use. Cross-carrier gaps of tens of
 *     milliseconds are partly geography, which is why `targets` travels with
 *     the number and is shown on hover.
 */
export const CARRIER_ORDER: CarrierKey[] = ['unicom', 'telecom', 'mobile'];

export const CARRIER_LABELS: Record<CarrierKey, string> = {
  unicom: '联通',
  telecom: '电信',
  mobile: '移动',
};

export type Tone = 'good' | 'warn' | 'bad' | 'unknown';

// Thresholds picked against the fleet as it actually measures: Tokyo sits near
// 40 ms, Los Angeles 130–230, Buffalo 220–270. A band that called 200 ms bad
// would paint two thirds of the fleet red and stop meaning anything.
export function latencyTone(ms: number | null): Tone {
  if (ms === null) return 'unknown';
  if (ms < 120) return 'good';
  if (ms < 240) return 'warn';
  return 'bad';
}

// Loss is different: it has a correct value, and that value is zero. Anything
// standing above the noise floor of a three-sample window is worth colour.
export function lossTone(pct: number | null): Tone {
  if (pct === null) return 'unknown';
  if (pct <= 0) return 'good';
  if (pct < 10) return 'warn';
  return 'bad';
}

export type CarrierRow = {
  key: CarrierKey;
  label: string;
  probed: boolean;
  latencyMs: number | null;
  lossPct: number | null;
  samples: number;
  latencyText: string;
  lossText: string;
  latencyTone: Tone;
  lossTone: Tone;
  /** What was pinged, for the title attribute. Empty when nothing was. */
  detail: string;
  history: Array<{ latencyMs: number | null; lossPct: number | null }>;
};

export function carrierRows(carriers: CarrierPingMapDto): CarrierRow[] {
  return CARRIER_ORDER.map((key) => {
    const entry: CarrierPingDto | undefined = carriers?.[key];
    const probed = Boolean(entry && entry.samples > 0);
    const latencyMs = probed ? entry!.latencyMs : null;
    const lossPct = probed ? entry!.lossPct : null;
    return {
      key,
      label: CARRIER_LABELS[key],
      probed,
      latencyMs,
      lossPct,
      samples: entry?.samples ?? 0,
      latencyText: latencyMs === null ? '—' : `${Math.round(latencyMs)} ms`,
      lossText: lossPct === null ? '—' : `${lossPct.toFixed(1)}%`,
      latencyTone: latencyTone(latencyMs),
      lossTone: lossTone(lossPct),
      detail: probed
        ? `${entry!.targets.join(' / ')}\n${entry!.samples} 次探测（近 1 小时）`
        : `没有匹配到${CARRIER_LABELS[key]}的 Ping 任务，或还没有样本`,
      history: probed ? entry!.history : [],
    };
  });
}

/**
 * The one line the collapsed table row can afford: the carrier doing worst.
 *
 * Loss outranks latency because a lossy path is broken while a slow one is
 * merely slow. Returns null when nothing was probed — the caller shows nothing
 * rather than a reassuring dash.
 */
export function worstCarrier(carriers: CarrierPingMapDto): CarrierRow | null {
  const probed = carrierRows(carriers).filter((row) => row.probed);
  if (!probed.length) return null;
  return probed.reduce((worst, row) => {
    const lossGap = (row.lossPct ?? 0) - (worst.lossPct ?? 0);
    if (Math.abs(lossGap) > 0.01) return lossGap > 0 ? row : worst;
    return (row.latencyMs ?? 0) > (worst.latencyMs ?? 0) ? row : worst;
  });
}
