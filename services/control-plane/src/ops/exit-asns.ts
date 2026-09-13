// Known exit ASNs, auto-recorded from exit-agent requests.
//
// request.cf.asn on an exit-agent call is the exit's hosting-provider ASN
// (a large cloud/transit ASN shared with other customers). A client that
// uploads from the same ASN is flagged edge_via_exit even if it did not
// traverse a Tono exit. That is the grain of this table; we do not match
// as_org.
//
// loadKnownExitAsns caches one Set per isolate for KNOWN_EXIT_ASNS_TTL_MS.
// A newly seen ASN is visible immediately in the isolate that recorded it,
// and within five minutes across other isolates.

import type { EdgeCf } from './flatten';

export const KNOWN_EXIT_ASNS_TTL_MS = 5 * 60_000;

let cached: Set<number> | null = null;
let loadedAt = 0;

export function resetKnownExitAsnsCache(): void {
  cached = null;
  loadedAt = 0;
}

function finiteInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function textOrNull(value: unknown, max?: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return max != null && trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function upsertExitAsn(
  db: D1Database,
  cf: EdgeCf | undefined,
  nodeHint: string | null,
  nowSec: number,
): Promise<number | null> {
  const asn = finiteInt(cf?.asn);
  if (asn == null) return null;
  const asOrg = textOrNull(cf?.asOrganization, 120);
  const hint = textOrNull(nodeHint, 120);
  await db.prepare(
    `INSERT INTO ops_exit_asns(asn, as_org, node_hint, source, first_seen_at, last_seen_at)
     VALUES(?, ?, ?, 'exit-agent', ?, ?)
     ON CONFLICT(asn) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).bind(asn, asOrg, hint, nowSec, nowSec).run();
  // Only mutate an already-loaded cache. Creating a one-element cache here
  // would hide other ASNs until TTL expiry.
  if (cached) cached.add(asn);
  return asn;
}

export async function loadKnownExitAsns(db: D1Database): Promise<Set<number>> {
  const nowMs = Date.now();
  if (cached && nowMs - loadedAt < KNOWN_EXIT_ASNS_TTL_MS) return cached;
  const rows = await db.prepare('SELECT asn FROM ops_exit_asns').all<{ asn: number }>();
  cached = new Set((rows.results ?? []).map((row) => Number(row.asn)));
  loadedAt = nowMs;
  return cached;
}
