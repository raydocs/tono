// Immutable node_id for a catalog_name. Display names live here so a rename
// never rewires ops_node_status / occupancy / history, which stay keyed on
// catalog_name. Cron's project step inserts a row for any name that has
// appeared in profiles, status, or the managed catalog.

import { catalogNames, loadProfile, loadStatus } from './handlers/nodes-data';
import { Env, Row, missingTable, nullText } from './handlers/common';

export type NodeIdentityFields = {
  nodeId?: string;
  displayName?: string;
  failureDomain?: string;
  replaces?: string;
};

export function identityFields(profile: Row | null, identity: Row | null): NodeIdentityFields {
  const nodeId = nullText(identity?.node_id);
  const displayName = nullText(identity?.display_name);
  const failureDomain = nullText(profile?.failure_domain);
  const replaces = nullText(profile?.replaces);
  return {
    ...(nodeId ? { nodeId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(failureDomain ? { failureDomain } : {}),
    ...(replaces ? { replaces } : {}),
  };
}

export async function loadIdentity(e: Env, name: string): Promise<Row | null> {
  try {
    return await e.DB.prepare('SELECT * FROM ops_node_identity WHERE name = ?').bind(name).first<Row>();
  } catch (error) {
    if (!missingTable(error)) throw error;
    return null;
  }
}

export async function loadIdentities(e: Env): Promise<Map<string, Row>> {
  try {
    const rows = (await e.DB.prepare('SELECT * FROM ops_node_identity').all<Row>()).results ?? [];
    return new Map(rows.map((row) => [String(row.name), row]));
  } catch (error) {
    if (!missingTable(error)) throw error;
    return new Map();
  }
}

export async function catalogNameExists(e: Env, name: string): Promise<boolean> {
  if (await loadProfile(e, name)) return true;
  if (await loadStatus(e, name)) return true;
  const names = await catalogNames(e);
  return names?.has(name) === true;
}

export async function upsertNodeIdentity(
  e: Env,
  name: string,
  nowSec: number,
  displayName: string | null | undefined,
): Promise<void> {
  try {
    if (displayName === undefined) {
      await e.DB.prepare(
        `INSERT OR IGNORE INTO ops_node_identity(node_id, name, display_name, first_seen_at, retired_at)
         VALUES(lower(hex(randomblob(8))), ?, NULL, ?, NULL)`,
      ).bind(name, nowSec).run();
      return;
    }
    await e.DB.prepare(
      `INSERT INTO ops_node_identity(node_id, name, display_name, first_seen_at, retired_at)
       VALUES(lower(hex(randomblob(8))), ?, ?, ?, NULL)
       ON CONFLICT(name) DO UPDATE SET display_name = excluded.display_name`,
    ).bind(name, displayName, nowSec).run();
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

export async function ensureNodeIdentities(e: Env, nowSec: number): Promise<void> {
  try {
    await e.DB.prepare(
      `INSERT OR IGNORE INTO ops_node_identity(node_id, name, display_name, first_seen_at, retired_at)
       SELECT lower(hex(randomblob(8))), catalog_name, NULL,
         COALESCE(created_at, ?),
         CASE WHEN status = 'retired' THEN updated_at END
       FROM ops_node_profiles`,
    ).bind(nowSec).run();
    await e.DB.prepare(
      `INSERT OR IGNORE INTO ops_node_identity(node_id, name, display_name, first_seen_at, retired_at)
       SELECT lower(hex(randomblob(8))), node_name, NULL, ?, NULL
       FROM ops_node_status`,
    ).bind(nowSec).run();
  } catch (error) {
    if (!missingTable(error)) throw error;
    return;
  }
  const names = await catalogNames(e);
  if (!names || names.size === 0) return;
  const stmts = [...names].map((name) => e.DB.prepare(
    `INSERT OR IGNORE INTO ops_node_identity(node_id, name, display_name, first_seen_at, retired_at)
     VALUES(lower(hex(randomblob(8))), ?, NULL, ?, NULL)`,
  ).bind(name, nowSec));
  try {
    await e.DB.batch(stmts);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}
