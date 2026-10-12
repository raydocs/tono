// Which control-plane path each client ASN reaches us on, and how often the
// paths tried before it failed (decision 080). One row per UTC day, ASN and
// path in `ops_api_path_daily`; no IP, URL path, user or device id is kept.

import type { ApiPathKind, ApiPathRowDto, ApiPathsDto } from './ops/contract/api-paths';
import { loadKnownExitAsns } from './ops/exit-asns';
import type { EdgeCf } from './ops/flatten';

const DAY = 86_400;
export const API_PATH_WINDOW_DAYS = 7;
const MAX_ROWS = 300;

/** Paths whose requests leave from a Tono node, so the edge ASN is the node's, not the customer's. */
const NODE_EGRESS_PATHS = new Set(['relay', 'tunnel']);

function asnOf(cf: EdgeCf | undefined): number | null {
  const n = typeof cf?.asn === 'string' ? Number(cf.asn) : cf?.asn;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The customer's ASN for this request, or 0 (unknown) when the edge saw a Tono node instead. */
async function customerAsn(db: D1Database, path: string, cf: EdgeCf | undefined): Promise<number> {
  if (NODE_EGRESS_PATHS.has(path)) return 0;
  const asn = asnOf(cf);
  if (asn === null) return 0;
  let exits: Set<number>;
  try {
    exits = await loadKnownExitAsns(db);
  } catch {
    // Without the exit list we cannot tell a customer from a node: say unknown.
    return 0;
  }
  return exits.has(asn) ? 0 : asn;
}

const UPSERT = `INSERT INTO ops_api_path_daily(day_at, asn, path, as_org, arrived, ok, fail, updated_at)
  VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(day_at, asn, path) DO UPDATE SET
    arrived = arrived + excluded.arrived,
    ok = ok + excluded.ok,
    fail = fail + excluded.fail,
    as_org = COALESCE(excluded.as_org, as_org),
    updated_at = excluded.updated_at`;

/**
 * Count one stamped arrival on `path`. `failed` is the parsed
 * `X-Tono-Path-Failed` list: null for a client that does not report (its
 * arrival counts in `arrived` only), otherwise the arrival counts as `ok` and
 * each listed path gets one `fail`, under the same ASN.
 */
export async function recordApiPath(
  db: D1Database,
  req: Request,
  path: string,
  failed: string[] | null,
  nowSec: number,
): Promise<void> {
  const cf = (req as { cf?: EdgeCf }).cf;
  const asn = await customerAsn(db, path, cf);
  const org = asn > 0 && typeof cf?.asOrganization === 'string' ? cf.asOrganization.trim().slice(0, 120) || null : null;
  const day = nowSec - (nowSec % DAY);
  const row = (kind: string, arrived: number, ok: number, fail: number) =>
    db.prepare(UPSERT).bind(day, asn, kind, org, arrived, ok, fail, nowSec);
  await db.batch([
    row(path, 1, failed === null ? 0 : 1, 0),
    ...(failed ?? []).map((kind) => row(kind, 0, 0, 1)),
  ]);
}

type Row = {
  asn: number; as_org: string | null; path: string;
  arrived: number; ok: number; fail: number; updated_at: number;
};

/** The last `API_PATH_WINDOW_DAYS` UTC days, today included, one row per ASN and path. */
export async function loadApiPaths(db: D1Database, nowSec: number): Promise<ApiPathsDto> {
  const since = nowSec - (nowSec % DAY) - (API_PATH_WINDOW_DAYS - 1) * DAY;
  const result = await db.prepare(
    `SELECT asn, MAX(as_org) AS as_org, path, SUM(arrived) AS arrived, SUM(ok) AS ok, SUM(fail) AS fail,
            MAX(updated_at) AS updated_at
     FROM ops_api_path_daily WHERE day_at >= ?
     GROUP BY asn, path
     ORDER BY SUM(arrived) + SUM(fail) DESC, asn ASC, path ASC
     LIMIT ?`,
  ).bind(since, MAX_ROWS).all<Row>();
  const rows: ApiPathRowDto[] = (result.results ?? []).map((row) => {
    const ok = Number(row.ok);
    const fail = Number(row.fail);
    const reported = ok + fail;
    return {
      asn: Number(row.asn) > 0 ? Number(row.asn) : null,
      asOrg: row.as_org ?? null,
      path: row.path as ApiPathKind,
      arrived: Number(row.arrived),
      ok,
      fail,
      successRate: reported > 0
        ? { value: ok / reported, asOfSec: Number(row.updated_at), source: 'telemetry' }
        : { value: null, asOfSec: null, source: 'telemetry' },
    };
  });
  return { since, days: API_PATH_WINDOW_DAYS, rows };
}
