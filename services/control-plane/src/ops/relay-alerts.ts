// API relay alerts (backlog A6, docs/ops/api-relay.md): turn the two relay signals into
// incidents, so the existing ops_alert_rules outbox sends one message when a
// relay starts failing and one when it recovers, and nothing in between.
//
// Signals, per relay in API_RELAYS (a row for a relay no longer listed is
// ignored, so a retired relay cannot alert forever):
// - TCP: the Worker cron's open-port check (`api_relay_probes`, src/api-relays.ts).
// - End to end: the relay node's own HTTPS check through its :2053
//   (`api_relay_reports`, src/api-relay-report.ts). A report older than 15 min
//   is a failure of this signal: the node checks every 5 min, so silence that
//   long is three missed checks. No report ever (node agent not installed)
//   is no signal, not a failure.
//
// Either signal failing RELAY_FAIL_STREAK consecutive checks opens the
// incident; the incident clears when neither does. The count is not stored:
// both checks run every RELAY_CHECK_CADENCE_SECONDS and any success resets the
// row's `failing_since`, so the checks in the current failing run are the
// cadences between `failing_since` and the latest failed check, plus one.
// No migration and no extra write per tick.

import { API_RELAYS, relayKey, type ApiRelay } from '../api-relays';
import type { IncidentDesire } from './verdict';

export const RELAY_INCIDENT_KIND = 'api-relay-down';
export const RELAY_FAIL_STREAK = 3;
/** The Worker cron and the node timer both run every five minutes. */
export const RELAY_CHECK_CADENCE_SECONDS = 300;
/** Same line as the console's 「上报过期」 (`END_TO_END_STALE_SEC`). */
export const RELAY_REPORT_STALE_SECONDS = 15 * 60;

type Row = Record<string, unknown>;

export type RelaySignal = {
  ok: boolean;
  /** `checked_at` for the TCP probe, `observed_at` for the node report. */
  at: number;
  failingSince: number | null;
  error: string | null;
};

export type RelaySignals = { tcp: RelaySignal | null; e2e: RelaySignal | null };

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

/** Failed checks in the current run; 0 when the latest check passed. */
export function consecutiveFailures(signal: RelaySignal | null): number {
  if (!signal || signal.ok) return 0;
  const since = signal.failingSince ?? signal.at;
  // Rounded, not floored: a cron tick that fires a few seconds late must not
  // make the third failure read as the second.
  return Math.max(0, Math.round((signal.at - since) / RELAY_CHECK_CADENCE_SECONDS)) + 1;
}

function clip(text: string | null): string {
  if (!text) return '';
  return `（${text.slice(0, 120)}）`;
}

/** Pure: one desire per relay whose TCP or end-to-end signal has tripped. */
export function relayDesires(
  relays: readonly ApiRelay[],
  signals: ReadonlyMap<string, RelaySignals>,
  nowSec: number,
): IncidentDesire[] {
  const desires: IncidentDesire[] = [];
  for (const relay of relays) {
    const key = relayKey(relay);
    const s = signals.get(key) ?? { tcp: null, e2e: null };
    const tcpFails = consecutiveFailures(s.tcp);
    const e2eAge = s.e2e ? nowSec - s.e2e.at : null;
    const e2eStale = e2eAge != null && e2eAge > RELAY_REPORT_STALE_SECONDS;
    const e2eFails = consecutiveFailures(s.e2e);
    const tcpDown = tcpFails >= RELAY_FAIL_STREAK;
    const e2eDown = e2eStale || e2eFails >= RELAY_FAIL_STREAK;
    if (!tcpDown && !e2eDown) continue;
    const parts: string[] = [];
    if (tcpDown) parts.push(`TCP 可达：连续 ${tcpFails} 次失败${clip(s.tcp?.error ?? null)}`);
    if (e2eStale) parts.push(`端到端：节点 ${Math.floor((e2eAge ?? 0) / 60)} 分钟未上报`);
    else if (e2eDown) parts.push(`端到端：连续 ${e2eFails} 次失败${clip(s.e2e?.error ?? null)}`);
    desires.push({
      dedupeKey: `${RELAY_INCIDENT_KIND}:${key}`,
      kind: RELAY_INCIDENT_KIND,
      subjectType: 'fleet',
      subjectId: key,
      severity: 'warn',
      title: `API 中继 ${relay.name} 探测连续失败`,
      detail: parts.join('；'),
      cause: tcpDown ? 'relay_tcp_failing' : e2eStale ? 'relay_report_stale' : 'relay_e2e_failing',
      impactCount: 0,
      evidence: {
        relay: key,
        tcpFailures: tcpFails,
        tcpCheckedAt: s.tcp?.at ?? null,
        e2eFailures: e2eFails,
        e2eObservedAt: s.e2e?.at ?? null,
        e2eStale,
      },
    });
  }
  return desires;
}

function signalOf(row: Row, atColumn: string): RelaySignal {
  return {
    ok: Number(row.ok) === 1,
    at: Number(row[atColumn]),
    failingSince: row.failing_since == null ? null : Number(row.failing_since),
    error: row.error == null ? null : String(row.error),
  };
}

async function rowsOf(db: D1Database, sql: string): Promise<Row[]> {
  try {
    return (await db.prepare(sql).all<Row>()).results ?? [];
  } catch (error) {
    // A database before 0095/0096: no relay signal yet, so no relay incident.
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function loadRelaySignals(db: D1Database): Promise<Map<string, RelaySignals>> {
  const out = new Map<string, RelaySignals>();
  const slot = (key: string) => {
    let s = out.get(key);
    if (!s) out.set(key, s = { tcp: null, e2e: null });
    return s;
  };
  for (const row of await rowsOf(db, 'SELECT relay, checked_at, ok, error, failing_since FROM api_relay_probes')) {
    slot(String(row.relay)).tcp = signalOf(row, 'checked_at');
  }
  for (const row of await rowsOf(db, 'SELECT relay, observed_at, ok, error, failing_since FROM api_relay_reports')) {
    slot(String(row.relay)).e2e = signalOf(row, 'observed_at');
  }
  return out;
}

export async function loadRelayDesires(
  db: D1Database,
  nowSec: number,
  relays: readonly ApiRelay[] = API_RELAYS,
): Promise<IncidentDesire[]> {
  return relayDesires(relays, await loadRelaySignals(db), nowSec);
}
