// Who still depends on a node we are taking out of the catalog, and the
// existing exit-token revoke (rotate hash + disable) used once they have left.

import { randomToken, sha256 } from '../crypto';
import { type Env, type Row, id, now } from '../env';
import { writeOpsAudit } from '../product-account';
import {
  assertRetireDependencies,
  type RetireCustomerOnNodeDto,
  type RetireDependenciesDto,
} from './contract';
import {
  decodeName,
  entityJson,
  missingTable,
  weakEtag,
} from './handlers/common';
import { catalogNames, requireNode } from './handlers/nodes-data';
import { RETIRE_DRAIN_SECONDS } from './verdict';

export type { RetireDependenciesDto };

export function retirePendingDedupeKey(name: string): string {
  return `node:${name}:retire_pending`;
}

function latestPerUser(rows: RetireCustomerOnNodeDto[]): RetireCustomerOnNodeDto[] {
  const byUser = new Map<string, RetireCustomerOnNodeDto>();
  for (const row of rows) {
    const current = byUser.get(row.userId);
    if (!current || row.lastSeenAt > current.lastSeenAt) byUser.set(row.userId, row);
  }
  return [...byUser.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.userId.localeCompare(b.userId));
}

async function queryCustomers(
  e: Env,
  sql: string,
  name: string,
  cutoff: number,
): Promise<RetireCustomerOnNodeDto[]> {
  try {
    const rows = await e.DB.prepare(sql).bind(name, cutoff).all<Row>();
    return (rows.results ?? []).map((row) => ({
      userId: String(row.user_id),
      email: String(row.email ?? ''),
      lastSeenAt: Number(row.last_seen_at) || 0,
    })).filter((row) => row.userId && row.lastSeenAt > 0);
  } catch (error) {
    if (!missingTable(error)) throw error;
    return [];
  }
}

export async function retireDependencies(
  e: Env,
  name: string,
  nowSec = now(),
): Promise<RetireDependenciesDto> {
  const cutoff = nowSec - RETIRE_DRAIN_SECONDS;
  const [fromCustomer, fromDevice, bindings, exit] = await Promise.all([
    queryCustomers(
      e,
      `SELECT s.user_id, u.email, s.last_seen_at
       FROM ops_customer_status s JOIN users u ON u.id = s.user_id
       WHERE s.selected_server = ? AND s.last_seen_at >= ?`,
      name,
      cutoff,
    ),
    queryCustomers(
      e,
      `SELECT d.user_id, u.email, d.last_seen_at
       FROM ops_device_status d JOIN users u ON u.id = d.user_id
       WHERE d.selected_server = ? AND d.last_seen_at >= ?`,
      name,
      cutoff,
    ),
    (async () => {
      try {
        const row = await e.DB.prepare(
          'SELECT COUNT(*) AS n FROM user_home_bindings WHERE default_proxy_name = ?',
        ).bind(name).first<Row>();
        return Number(row?.n ?? 0) || 0;
      } catch (error) {
        if (!missingTable(error)) throw error;
        return 0;
      }
    })(),
    (async () => {
      try {
        return await e.DB.prepare(
          'SELECT status, last_roster_at FROM exit_nodes WHERE name = ?',
        ).bind(name).first<Row>();
      } catch (error) {
        if (!missingTable(error)) throw error;
        return null;
      }
    })(),
  ]);
  const roster = exit?.last_roster_at == null ? null : Number(exit.last_roster_at);
  return {
    customersOnNode: latestPerUser([...fromCustomer, ...fromDevice]),
    defaultProxyBindings: bindings,
    exitTokenActive: String(exit?.status ?? '') === 'active',
    lastRosterAt: roster != null && roster > 0 ? roster : null,
  };
}

/** Existing exit_nodes rotate (token_hash) plus disable. Same UPDATEs as POST token / PATCH status. */
export async function revokeExitToken(
  e: Env,
  name: string,
  actorEmail: string,
  nowSec: number,
): Promise<boolean> {
  try {
    const row = await e.DB.prepare(
      "SELECT id, status FROM exit_nodes WHERE name = ?",
    ).bind(name).first<Row>();
    if (!row || String(row.status) !== 'active') return false;
    const token = randomToken();
    const updated = await e.DB.prepare(
      `UPDATE exit_nodes
       SET token_hash = ?, status = 'disabled', updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(await sha256(token), nowSec, String(row.id)).run();
    if (!Number(updated.meta.changes ?? 0)) return false;
    await writeOpsAudit(
      e,
      actorEmail,
      'node.exit_token.revoke',
      'exit_node',
      String(row.id),
      `revoked exit token for ${name}`,
    );
    return true;
  } catch (error) {
    if (!missingTable(error)) throw error;
    return false;
  }
}

function retirePendingTitle(count: number): string {
  return `${count} 位客户仍在这台机器上`.slice(0, 200);
}

export async function openOrReuseRetirePending(
  e: Env,
  name: string,
  impactCount: number,
  nowSec: number,
): Promise<void> {
  const key = retirePendingDedupeKey(name);
  const title = retirePendingTitle(impactCount);
  try {
    const existing = await e.DB.prepare(
      `SELECT id FROM ops_incidents WHERE dedupe_key = ? AND status <> 'resolved'`,
    ).bind(key).first<{ id: string }>();
    if (existing) {
      await e.DB.prepare(
        `UPDATE ops_incidents
         SET impact_count = ?, last_seen_at = ?, updated_at = ?, title = ?
         WHERE id = ?`,
      ).bind(impactCount, nowSec, nowSec, title, existing.id).run();
      return;
    }
    const incidentId = id();
    await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO ops_incidents(
           id, dedupe_key, kind, subject_type, subject_id, severity, status,
           title, detail, cause, parent_incident_id, rules_version,
           opened_at, last_seen_at, impact_count, evidence_json, updated_at
         ) VALUES(?, ?, 'retire_pending', 'node', ?, 'notice', 'open',
                  ?, ?, 'retire_pending', NULL, 1, ?, ?, ?, ?, ?)`,
      ).bind(
        incidentId, key, name, title, name, nowSec, nowSec, impactCount,
        JSON.stringify({ occupancy: impactCount }), nowSec,
      ),
      e.DB.prepare(
        `INSERT INTO ops_incident_events(id, incident_id, at, type, actor, detail, data_json)
         VALUES(?, ?, ?, 'opened', NULL, ?, NULL)`,
      ).bind(id(), incidentId, nowSec, title),
    ]);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

export async function finishDrainedRetires(e: Env, actorEmail: string, nowSec: number): Promise<number> {
  let names: string[] = [];
  try {
    const rows = await e.DB.prepare(
      "SELECT catalog_name FROM ops_node_profiles WHERE status = 'retired'",
    ).all<{ catalog_name: string }>();
    names = (rows.results ?? []).map((row) => String(row.catalog_name));
  } catch (error) {
    if (!missingTable(error)) throw error;
    return 0;
  }
  if (names.length === 0) return 0;
  const listed = await catalogNames(e);
  let revoked = 0;
  for (const name of names) {
    if (listed?.has(name)) continue;
    const deps = await retireDependencies(e, name, nowSec);
    if (deps.customersOnNode.length > 0) continue;
    if (await revokeExitToken(e, name, actorEmail, nowSec)) revoked += 1;
  }
  return revoked;
}

export async function getNodeRetirePreview(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  await requireNode(e, name);
  const dto = await retireDependencies(e, name);
  return entityJson(
    e, req, dto,
    weakEtag([
      name,
      dto.customersOnNode.length,
      dto.defaultProxyBindings,
      Number(dto.exitTokenActive),
      dto.lastRosterAt,
    ]),
    assertRetireDependencies,
  );
}
