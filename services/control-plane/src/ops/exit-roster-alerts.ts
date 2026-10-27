// An exit node whose agent stopped acknowledging its roster (exit-agent
// `/api/v1/home/roster-ack`) is silently dropped from every customer's catalog
// once the last acknowledgement is ROSTER_FRESH_SEC old (`exitAckGate` in
// catalog.ts). The agent withholds the acknowledgement on purpose whenever a
// round could not prove the roster enforced: a client add or a revocation the
// Xray API refused, an unprovable inventory, a hy2 publish failure. Until now
// nothing told an operator, so a single stuck revocation could take a node out
// of service with no alert. This turns that state into a node incident; the
// existing ops_alert_rules outbox sends it, and it resolves on the next ACK.
//
// A node that never acknowledged (agent not installed yet) is no signal, as in
// relay-alerts.ts. Disabled and retired nodes are lifecycle facts, not
// incidents. No migration and no write.

import { ROSTER_FRESH_SEC } from '../catalog';
import type { IncidentDesire } from './verdict';

export const EXIT_ROSTER_STALE_KIND = 'node-roster-stale';

export async function loadExitRosterDesires(db: D1Database, nowSec: number): Promise<IncidentDesire[]> {
  let rows: Array<{ name: string; last_roster_at: number }>;
  try {
    rows = (await db.prepare(
      `SELECT name, last_roster_at FROM exit_nodes
       WHERE status = 'active' AND last_roster_at > 0 AND last_roster_at <= ?`,
    ).bind(nowSec - ROSTER_FRESH_SEC).all<{ name: string; last_roster_at: number }>()).results ?? [];
  } catch (error) {
    if (String(error).includes('no such table')) return [];
    throw error;
  }
  return rows.map((row) => {
    const lastRosterAt = Number(row.last_roster_at);
    const minutes = Math.floor((nowSec - lastRosterAt) / 60);
    return {
      dedupeKey: `${EXIT_ROSTER_STALE_KIND}:${row.name}`,
      kind: EXIT_ROSTER_STALE_KIND,
      subjectType: 'node',
      subjectId: String(row.name),
      severity: 'warn',
      title: `${row.name} ${minutes} 分钟未确认名单，已移出客户目录`,
      detail: 'exit-agent 未发 roster ACK：看节点日志里的 refusing 行（客户端增删失败、撤销未完成或 hy2 发布失败）',
      cause: 'roster_unacknowledged',
      impactCount: 0,
      evidence: { lastRosterAt, staleSeconds: nowSec - lastRosterAt },
    };
  });
}
