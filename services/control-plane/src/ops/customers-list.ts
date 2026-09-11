// Paginated customer-list reads: SQL cursor, COUNT(*), fleet counts.

import {
  CUSTOMER_VERDICTS,
  FUNNEL_STAGES,
  type CustomerListCounts,
  type CustomerVerdict,
  type FunnelStage,
} from './contract';
import type { Cursor } from './http';
import { HEARTBEAT_FRESH_SECONDS } from './verdict-customers';

type Row = Record<string, any>;

function missingTable(error: unknown): boolean {
  const text = String(error);
  return text.includes('no such table') || text.includes('no such column');
}

export type CustomerListFilter = {
  q: string | null;
  since: number | null;
  nowSec: number;
};

function col(alias: string | undefined, name: string): string {
  return alias ? `${alias}.${name}` : name;
}

function filterSql(
  filter: CustomerListFilter,
  cursor: Cursor | null,
  alias?: string,
): { sql: string; binds: unknown[] } {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (cursor) {
    clauses.push(`(${col(alias, 'email')} > ? OR (${col(alias, 'email')} = ? AND ${col(alias, 'id')} > ?))`);
    binds.push(cursor.sortKey, cursor.sortKey, cursor.id);
  }
  if (filter.q) {
    clauses.push(
      `(INSTR(LOWER(${col(alias, 'email')}), ?) > 0 OR INSTR(LOWER(COALESCE(${col(alias, 'wechat_id')}, '')), ?) > 0)`,
    );
    binds.push(filter.q, filter.q);
  }
  if (filter.since != null) {
    clauses.push(`COALESCE(NULLIF(${col(alias, 'updated_at')}, 0), ?) >= ?`);
    binds.push(filter.nowSec, filter.since);
  }
  return { sql: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`, binds };
}

async function firstRow<T>(
  db: D1Database,
  sql: string,
  binds: unknown[],
): Promise<T | null> {
  const stmt = db.prepare(sql);
  const row = binds.length > 0 ? await stmt.bind(...binds).first<T>() : await stmt.first<T>();
  return row ?? null;
}

async function allRows(db: D1Database, sql: string, binds: unknown[]): Promise<Row[]> {
  const stmt = db.prepare(sql);
  const result = binds.length > 0 ? await stmt.bind(...binds).all<Row>() : await stmt.all<Row>();
  return result.results ?? [];
}

export async function loadCustomerPage(
  db: D1Database,
  filter: CustomerListFilter,
  cursor: Cursor | null,
  limit: number,
): Promise<{ users: Row[]; total: number }> {
  const page = filterSql(filter, cursor);
  const count = filterSql(filter, null);
  try {
    const counted = await firstRow<{ c: number }>(
      db, `SELECT COUNT(*) AS c FROM users ${count.sql}`, count.binds,
    );
    const users = await allRows(
      db,
      `SELECT * FROM users ${page.sql} ORDER BY email ASC, id ASC LIMIT ?`,
      [...page.binds, limit + 1],
    );
    return { users, total: Number(counted?.c ?? 0) };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { users: [], total: 0 };
  }
}

function emptyCounts(): CustomerListCounts {
  const byVerdict = {} as Record<CustomerVerdict, number>;
  for (const verdict of CUSTOMER_VERDICTS) byVerdict[verdict] = 0;
  const byStage = {} as Record<FunnelStage, number>;
  for (const stage of FUNNEL_STAGES) byStage[stage] = 0;
  return { byVerdict, byStage };
}

function addCounts<T extends string>(into: Record<T, number>, key: string, n: number): void {
  if (key in into) into[key as T] += n;
}

export async function loadCustomerListCounts(
  db: D1Database,
  filter: CustomerListFilter,
): Promise<CustomerListCounts> {
  const out = emptyCounts();
  const { sql, binds } = filterSql(filter, null, 'u');
  const cutoff = filter.nowSec - HEARTBEAT_FRESH_SECONDS;
  try {
    const verdictRows = await allRows(
      db,
      `SELECT verdict, COUNT(*) AS n FROM (
         SELECT CASE
           WHEN i.kind = 'customer-repeat-fail' THEN 'unreachable'
           WHEN i.kind IN ('customer-path-slow', 'customer-switch-churn') THEN 'unstable'
           WHEN s.user_id IS NULL OR (s.first_connected_at IS NULL AND IFNULL(s.connected, 0) = 0)
             THEN 'never_used'
           WHEN s.last_seen_at IS NULL OR s.last_seen_at < ? THEN 'unreported'
           WHEN s.connected = 1 THEN 'ok'
           ELSE 'offline'
         END AS verdict
         FROM users u
         LEFT JOIN ops_customer_status s ON s.user_id = u.id
         LEFT JOIN (
           SELECT subject_id,
             CASE WHEN SUM(CASE WHEN kind = 'customer-repeat-fail' THEN 1 ELSE 0 END) > 0
               THEN 'customer-repeat-fail' ELSE MAX(kind) END AS kind
           FROM ops_incidents
           WHERE subject_type = 'user' AND status <> 'resolved'
             AND kind IN ('customer-repeat-fail', 'customer-path-slow', 'customer-switch-churn')
           GROUP BY subject_id
         ) i ON i.subject_id = u.id
         ${sql}
       ) GROUP BY verdict`,
      [cutoff, ...binds],
    );
    for (const row of verdictRows) addCounts(out.byVerdict, String(row.verdict), Number(row.n) || 0);

    const inviteClauses: string[] = [
      `NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(a.email))`,
    ];
    const inviteBinds: unknown[] = [];
    if (filter.q) {
      inviteClauses.push(
        `(INSTR(LOWER(a.email), ?) > 0 OR INSTR(LOWER(COALESCE(a.wechat_id, '')), ?) > 0)`,
      );
      inviteBinds.push(filter.q, filter.q);
    }
    const stageRows = await allRows(
      db,
      `SELECT stage, COUNT(*) AS n FROM (
         SELECT CASE
           WHEN s.first_connected_at IS NOT NULL OR s.connected = 1 THEN 'connected'
           WHEN s.user_id IS NOT NULL OR h.user_id IS NOT NULL THEN 'reported'
           WHEN IFNULL(d.n, 0) > 0 THEN 'device_added'
           ELSE 'registered'
         END AS stage
         FROM users u
         LEFT JOIN ops_customer_status s ON s.user_id = u.id
         LEFT JOIN (SELECT user_id, COUNT(*) AS n FROM devices GROUP BY user_id) d ON d.user_id = u.id
         LEFT JOIN (SELECT user_id FROM customer_activity_hours GROUP BY user_id) h ON h.user_id = u.id
         ${sql}
         UNION ALL
         SELECT 'invited' AS stage
         FROM signup_allowlist a
         WHERE ${inviteClauses.join(' AND ')}
       ) GROUP BY stage`,
      [...binds, ...inviteBinds],
    );
    for (const row of stageRows) addCounts(out.byStage, String(row.stage), Number(row.n) || 0);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  return out;
}
