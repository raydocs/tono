// D1 persistence for ops verdicts. The pure engine lives in ./verdict; this
// file is the only one that talks to the database.

import {
  VERDICT_RULES_VERSION,
  type IncidentDesire,
  type NodePrior,
  type NodeVerdict,
  type VerdictOutput,
} from './verdict';

const BATCH = 50;
const EVIDENCE_MAX = 4096;
const TITLE_MAX = 200;
const DETAIL_MAX = 1000;

export type StoredNodeState = NodePrior & {
  nodeName: string;
  lastCustomerOkAt: number | null;
};

export type IncidentTransition = {
  incidentId: string;
  dedupeKey: string;
  transition: 'open' | 'escalate' | 'deescalate' | 'resolve';
  severity: 'severe' | 'warn' | 'notice';
};

type LiveIncident = {
  id: string;
  dedupe_key: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  severity: 'severe' | 'warn' | 'notice';
  status: string;
  snoozed_until: number | null;
  parent_incident_id: string | null;
};

const SEVERITY_RANK: Record<IncidentTransition['severity'], number> = {
  notice: 1,
  warn: 2,
  severe: 3,
};

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function clipJson(value: unknown): string | null {
  if (value == null) return null;
  const json = JSON.stringify(value);
  if (json.length <= EVIDENCE_MAX) return json;
  return JSON.stringify({ truncated: true });
}

function listedInt(value: boolean | null | undefined): number | null {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length === 0) return;
  for (let i = 0; i < statements.length; i += BATCH) {
    await db.batch(statements.slice(i, i + BATCH));
  }
}

function asVerdict(value: unknown, fallback: NodeVerdict): NodeVerdict {
  if (
    value === 'down' || value === 'blocked' || value === 'no_probe'
    || value === 'degraded' || value === 'pressure' || value === 'unknown' || value === 'ok'
  ) return value;
  return fallback;
}

export async function loadPriorNodeStates(db: D1Database): Promise<Map<string, StoredNodeState>> {
  try {
    const rows = await db.prepare(
      `SELECT node_name, verdict, candidate_verdict, candidate_streak, changed_at, last_customer_ok_at
       FROM ops_node_status`,
    ).all<{
      node_name: string;
      verdict: string;
      candidate_verdict: string | null;
      candidate_streak: number;
      changed_at: number;
      last_customer_ok_at: number | null;
    }>();
    const out = new Map<string, StoredNodeState>();
    for (const row of rows.results ?? []) {
      const verdict = asVerdict(row.verdict, 'unknown');
      out.set(String(row.node_name), {
        nodeName: String(row.node_name),
        verdict,
        candidateVerdict: asVerdict(row.candidate_verdict, verdict),
        candidateStreak: Number(row.candidate_streak) || 0,
        changedAt: Number(row.changed_at) || 0,
        lastCustomerOkAt: row.last_customer_ok_at == null ? null : Number(row.last_customer_ok_at),
      });
    }
    return out;
  } catch (error) {
    if (missingTable(error)) return new Map();
    throw error;
  }
}

export async function persistNodeStates(
  db: D1Database,
  output: VerdictOutput,
  nowSec: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const node of output.nodes) {
    statements.push(db.prepare(
      `INSERT INTO ops_node_status(
         node_name, verdict, label, reason, quality_status, agent_status,
         catalog_listed, occupancy, candidate_verdict, candidate_streak,
         last_quality_sweep_at, last_customer_ok_at, rules_version,
         evaluated_at, changed_at, evidence_json
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_name) DO UPDATE SET
         verdict = excluded.verdict,
         label = excluded.label,
         reason = excluded.reason,
         quality_status = excluded.quality_status,
         agent_status = excluded.agent_status,
         catalog_listed = excluded.catalog_listed,
         occupancy = excluded.occupancy,
         candidate_verdict = excluded.candidate_verdict,
         candidate_streak = excluded.candidate_streak,
         last_quality_sweep_at = excluded.last_quality_sweep_at,
         last_customer_ok_at = excluded.last_customer_ok_at,
         rules_version = excluded.rules_version,
         evaluated_at = excluded.evaluated_at,
         changed_at = excluded.changed_at,
         evidence_json = excluded.evidence_json`,
    ).bind(
      node.name,
      node.verdict,
      node.label,
      node.reason,
      node.qualityStatus,
      node.agentStatus,
      listedInt(node.catalogListed),
      node.occupancy,
      node.candidateVerdict,
      node.candidateStreak,
      node.lastQualitySweepAt,
      node.lastCustomerOkAt,
      output.rulesVersion,
      nowSec,
      node.changedAt,
      clipJson(node.evidence),
    ));
    if (node.changed) {
      statements.push(db.prepare(
        `INSERT INTO ops_node_status_history(
           id, node_name, at, from_verdict, to_verdict, reason, rules_version, evidence_json
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        node.name,
        nowSec,
        node.previousVerdict,
        node.verdict,
        node.reason,
        output.rulesVersion,
        clipJson(node.evidence),
      ));
    }
  }
  try {
    await runBatches(db, statements);
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}

async function loadLiveIncidents(db: D1Database): Promise<LiveIncident[]> {
  const rows = await db.prepare(
    `SELECT id, dedupe_key, kind, subject_type, subject_id, severity, status, snoozed_until, parent_incident_id
     FROM ops_incidents WHERE status <> 'resolved'`,
  ).all<LiveIncident>();
  return rows.results ?? [];
}

function snoozed(row: LiveIncident, nowSec: number): boolean {
  return row.snoozed_until != null && Number(row.snoozed_until) > nowSec;
}

function eventStatement(
  db: D1Database,
  incidentId: string,
  nowSec: number,
  type: 'opened' | 'escalated' | 'deescalated' | 'resolved',
  detail: string | null,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO ops_incident_events(id, incident_id, at, type, actor, detail, data_json)
     VALUES(?, ?, ?, ?, NULL, ?, NULL)`,
  ).bind(crypto.randomUUID(), incidentId, nowSec, type, detail);
}

function parentIdFor(
  parentDedupeKey: string | undefined,
  idByKey: Map<string, string>,
  resolving: Set<string>,
): string | null {
  if (!parentDedupeKey) return null;
  if (resolving.has(parentDedupeKey)) return null;
  return idByKey.get(parentDedupeKey) ?? null;
}

export async function reconcileIncidents(
  db: D1Database,
  desires: IncidentDesire[],
  nowSec: number,
): Promise<IncidentTransition[]> {
  let live: LiveIncident[];
  try {
    live = await loadLiveIncidents(db);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }

  const liveByKey = new Map(live.map((row) => [row.dedupe_key, row]));
  const desiredKeys = new Set(desires.map((desire) => desire.dedupeKey));
  const resolving = new Set<string>();
  for (const row of live) {
    if (!desiredKeys.has(row.dedupe_key)) resolving.add(row.dedupe_key);
  }

  const idByKey = new Map(live.map((row) => [row.dedupe_key, row.id]));
  const newIds = new Map<string, string>();
  for (const desire of desires) {
    if (!liveByKey.has(desire.dedupeKey)) {
      const id = crypto.randomUUID();
      newIds.set(desire.dedupeKey, id);
      idByKey.set(desire.dedupeKey, id);
    }
  }

  const statements: D1PreparedStatement[] = [];
  const transitions: IncidentTransition[] = [];
  const ordered = [...desires].sort((a, b) => {
    if (!a.parentDedupeKey && b.parentDedupeKey) return -1;
    if (a.parentDedupeKey && !b.parentDedupeKey) return 1;
    return 0;
  });

  for (const desire of ordered) {
    const existing = liveByKey.get(desire.dedupeKey);
    // Carried from the live table by a pass that did not measure it: it stays
    // open (it is in `desiredKeys`), and nothing about it is rewritten.
    if (existing && desire.carried) continue;
    const parentId = parentIdFor(desire.parentDedupeKey, idByKey, resolving);
    const title = clip(desire.title, TITLE_MAX) || '事故';
    const detail = desire.detail == null ? null : clip(desire.detail, DETAIL_MAX);
    const evidence = clipJson(desire.evidence);
    if (!existing) {
      const id = newIds.get(desire.dedupeKey)!;
      statements.push(db.prepare(
        `INSERT INTO ops_incidents(
           id, dedupe_key, kind, subject_type, subject_id, severity, status,
           title, detail, cause, parent_incident_id, rules_version,
           opened_at, last_seen_at, impact_count, evidence_json, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        desire.dedupeKey,
        desire.kind,
        desire.subjectType,
        desire.subjectId,
        desire.severity,
        title,
        detail,
        desire.cause,
        parentId,
        VERDICT_RULES_VERSION,
        nowSec,
        nowSec,
        desire.impactCount,
        evidence,
        nowSec,
      ));
      statements.push(eventStatement(db, id, nowSec, 'opened', title));
      transitions.push({
        incidentId: id,
        dedupeKey: desire.dedupeKey,
        transition: 'open',
        severity: desire.severity,
      });
      continue;
    }

    const quiet = snoozed(existing, nowSec);
    let nextSeverity = existing.severity;
    let transition: IncidentTransition['transition'] | null = null;
    if (!quiet) {
      const from = SEVERITY_RANK[existing.severity];
      const to = SEVERITY_RANK[desire.severity];
      if (to > from) {
        nextSeverity = desire.severity;
        transition = 'escalate';
      } else if (to < from) {
        nextSeverity = desire.severity;
        transition = 'deescalate';
      }
    }
    statements.push(db.prepare(
      `UPDATE ops_incidents
       SET last_seen_at = ?, updated_at = ?, title = ?, detail = ?, cause = ?,
           impact_count = ?, evidence_json = ?, parent_incident_id = ?,
           kind = ?, subject_type = ?, subject_id = ?, severity = ?
       WHERE id = ?`,
    ).bind(
      nowSec,
      nowSec,
      title,
      detail,
      desire.cause,
      desire.impactCount,
      evidence,
      parentId,
      desire.kind,
      desire.subjectType,
      desire.subjectId,
      nextSeverity,
      existing.id,
    ));
    if (transition) {
      statements.push(eventStatement(db, existing.id, nowSec, transition === 'escalate' ? 'escalated' : 'deescalated', title));
      transitions.push({
        incidentId: existing.id,
        dedupeKey: desire.dedupeKey,
        transition,
        severity: nextSeverity,
      });
    }
  }

  for (const row of live) {
    if (!resolving.has(row.dedupe_key)) continue;
    statements.push(db.prepare(
      `UPDATE ops_incidents
       SET parent_incident_id = NULL, updated_at = ?
       WHERE parent_incident_id = ? AND status <> 'resolved'`,
    ).bind(nowSec, row.id));
    statements.push(db.prepare(
      `UPDATE ops_incidents
       SET status = 'resolved', resolved_at = ?, resolve_reason = 'cleared', updated_at = ?
       WHERE id = ?`,
    ).bind(nowSec, nowSec, row.id));
    statements.push(eventStatement(db, row.id, nowSec, 'resolved', 'cleared'));
    transitions.push({
      incidentId: row.id,
      dedupeKey: row.dedupe_key,
      transition: 'resolve',
      severity: row.severity,
    });
  }

  try {
    await runBatches(db, statements);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return transitions;
}
