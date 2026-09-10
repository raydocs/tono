import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  loadPriorNodeStates,
  persistNodeStates,
  reconcileIncidents,
  type IncidentTransition,
} from '../src/ops/evaluate';
import {
  VERDICT_RULES_VERSION,
  evaluate,
  type IncidentDesire,
  type NodeVerdictResult,
  type VerdictOutput,
} from '../src/ops/verdict';

const db = () => (env as unknown as { DB: D1Database }).DB;
const NOW = 1_800_000_000;

function nodeResult(over: Partial<NodeVerdictResult> = {}): NodeVerdictResult {
  return {
    name: 'Tokyo · Test',
    verdict: 'ok',
    label: '大陆正常',
    reason: 'ok',
    qualityStatus: 'OK',
    agentStatus: 'online',
    catalogListed: true,
    occupancy: 0,
    candidateVerdict: 'ok',
    candidateStreak: 0,
    changed: true,
    previousVerdict: null,
    changedAt: NOW,
    lastCustomerOkAt: null,
    lastQualitySweepAt: NOW - 60,
    evidence: { observed: 'ok' },
    ...over,
  };
}

function output(nodes: NodeVerdictResult[], desires: IncidentDesire[] = []): VerdictOutput {
  return { rulesVersion: VERDICT_RULES_VERSION, nodes, desires, pathStreaks: {} };
}

function desire(over: Partial<IncidentDesire> & Pick<IncidentDesire, 'dedupeKey' | 'kind' | 'subjectId' | 'severity' | 'title'>): IncidentDesire {
  return {
    subjectType: 'node',
    detail: null,
    cause: over.kind,
    impactCount: 0,
    evidence: {},
    ...over,
  };
}

describe('persistNodeStates', () => {
  it('upserts status and appends history only when the verdict changes', async () => {
    const first = evaluate({
      nodes: [{
        name: 'Tokyo · Test',
        catalogListed: true,
        ok: true,
        blockStatus: 'OK',
        agentObservedAt: NOW - 30,
        carriers: null,
        machine: null,
        occupancy: 1,
        profileStatus: 'active',
        prior: null,
        fails30m: { attempts: 0, failures: 0, distinctUsers: 0, handshakeDistinctUsers: 0 },
        lastCustomerOkAt: NOW - 5,
        errorSpike: false,
      }],
      customers: [],
      nowSec: NOW,
      qualitySweepAt: NOW - 60,
      agentsSnapshotAt: NOW - 60,
      maintenance: new Set(),
    });
    await persistNodeStates(db(), first, NOW);
    const prior = await loadPriorNodeStates(db());
    expect(prior.get('Tokyo · Test')?.verdict).toBe('ok');

    const again = evaluate({
      nodes: [{
        name: 'Tokyo · Test',
        catalogListed: true,
        ok: true,
        blockStatus: 'OK',
        agentObservedAt: NOW - 20,
        carriers: null,
        machine: null,
        occupancy: 1,
        profileStatus: 'active',
        prior: {
          verdict: prior.get('Tokyo · Test')!.verdict,
          candidateVerdict: prior.get('Tokyo · Test')!.candidateVerdict,
          candidateStreak: prior.get('Tokyo · Test')!.candidateStreak,
          changedAt: prior.get('Tokyo · Test')!.changedAt,
        },
        fails30m: { attempts: 0, failures: 0, distinctUsers: 0, handshakeDistinctUsers: 0 },
        lastCustomerOkAt: NOW - 5,
        errorSpike: false,
      }],
      customers: [],
      nowSec: NOW + 60,
      qualitySweepAt: NOW,
      agentsSnapshotAt: NOW,
      maintenance: new Set(),
    });
    expect(again.nodes[0]?.changed).toBe(false);
    await persistNodeStates(db(), again, NOW + 60);

    const history = await db().prepare(
      'SELECT to_verdict FROM ops_node_status_history WHERE node_name = ? ORDER BY at, id',
    ).bind('Tokyo · Test').all<{ to_verdict: string }>();
    expect(history.results?.map((row) => row.to_verdict)).toEqual(['ok']);

    await persistNodeStates(db(), output([nodeResult({
      verdict: 'pressure',
      label: '高负载',
      reason: 'machine_pressure',
      previousVerdict: 'ok',
      changed: true,
      changedAt: NOW + 120,
    })]), NOW + 120);
    const after = await db().prepare(
      'SELECT COUNT(*) AS n FROM ops_node_status_history WHERE node_name = ?',
    ).bind('Tokyo · Test').first<{ n: number }>();
    expect(Number(after?.n)).toBe(2);
    expect((await loadPriorNodeStates(db())).get('Tokyo · Test')?.verdict).toBe('pressure');
  });
});

describe('reconcileIncidents', () => {
  it('opens, escalates, and resolves without duplicating the live row', async () => {
    const warn = desire({
      dedupeKey: 'node-degraded:Tokyo · Test',
      kind: 'node-degraded',
      subjectId: 'Tokyo · Test',
      severity: 'warn',
      title: '回程丢包',
      impactCount: 2,
    });
    const opened = await reconcileIncidents(db(), [warn], NOW);
    expect(opened).toEqual([expect.objectContaining({
      dedupeKey: warn.dedupeKey,
      transition: 'open',
      severity: 'warn',
    })]);

    const severe: IncidentDesire = { ...warn, severity: 'severe', title: '回程丢包加重' };
    const escalated = await reconcileIncidents(db(), [severe], NOW + 10);
    expect(escalated.map((row: IncidentTransition) => row.transition)).toEqual(['escalate']);

    const still = await reconcileIncidents(db(), [severe], NOW + 20);
    expect(still).toEqual([]);
    const live = await db().prepare(
      "SELECT COUNT(*) AS n FROM ops_incidents WHERE dedupe_key = ? AND status <> 'resolved'",
    ).bind(warn.dedupeKey).first<{ n: number }>();
    expect(Number(live?.n)).toBe(1);

    const resolved = await reconcileIncidents(db(), [], NOW + 30);
    expect(resolved.map((row) => row.transition)).toEqual(['resolve']);
    const gone = await db().prepare(
      'SELECT status, resolve_reason FROM ops_incidents WHERE dedupe_key = ?',
    ).bind(warn.dedupeKey).first<{ status: string; resolve_reason: string }>();
    expect(gone).toMatchObject({ status: 'resolved', resolve_reason: 'cleared' });
  });

  it('a carried desire keeps the live row alive without rewriting what it never measured', async () => {
    const measured = desire({
      dedupeKey: 'node-blocked:Tokyo · Test',
      kind: 'node-blocked',
      subjectId: 'Tokyo · Test',
      severity: 'severe',
      title: '被墙',
      evidence: { sweep: 'LIKELY_BLOCKED', carriers: 3 },
    });
    await reconcileIncidents(db(), [measured], NOW);
    const carried: IncidentDesire = { ...measured, evidence: {}, title: '被墙（读回）', carried: true };
    const quiet = await reconcileIncidents(db(), [carried], NOW + 300);
    expect(quiet).toEqual([]);
    const row = await db().prepare(
      'SELECT status, title, last_seen_at, evidence_json FROM ops_incidents WHERE dedupe_key = ?',
    ).bind(measured.dedupeKey).first<{ status: string; title: string; last_seen_at: number; evidence_json: string }>();
    expect(row?.status).toBe('open');
    expect(row?.title).toBe('被墙');
    expect(Number(row?.last_seen_at)).toBe(NOW);
    expect(JSON.parse(row?.evidence_json ?? '{}')).toEqual({ sweep: 'LIKELY_BLOCKED', carriers: 3 });
    // Without the carried desire the pass resolves it, as before.
    const resolved = await reconcileIncidents(db(), [], NOW + 600);
    expect(resolved.map((row) => row.transition)).toEqual(['resolve']);
  });

  it('refuses a second live row with the same dedupe_key', async () => {
    await db().prepare(
      `INSERT INTO ops_incidents(
         id, dedupe_key, kind, subject_type, subject_id, severity, status,
         title, rules_version, opened_at, last_seen_at, impact_count, updated_at
       ) VALUES('inc-1', 'node-down:n', 'node-down', 'node', 'n', 'severe', 'open',
         '整机失联', 1, ?, ?, 0, ?)`,
    ).bind(NOW, NOW, NOW).run();
    await expect(db().prepare(
      `INSERT INTO ops_incidents(
         id, dedupe_key, kind, subject_type, subject_id, severity, status,
         title, rules_version, opened_at, last_seen_at, impact_count, updated_at
       ) VALUES('inc-2', 'node-down:n', 'node-down', 'node', 'n', 'severe', 'open',
         '整机失联', 1, ?, ?, 0, ?)`,
    ).bind(NOW, NOW, NOW).run()).rejects.toThrow();
  });

  it('keeps bumping last_seen_at while snoozed and does not change severity', async () => {
    const item = desire({
      dedupeKey: 'node-pressure:n',
      kind: 'node-pressure',
      subjectId: 'n',
      severity: 'warn',
      title: '高负载',
    });
    const [opened] = await reconcileIncidents(db(), [item], NOW);
    await db().prepare(
      'UPDATE ops_incidents SET snoozed_until = ? WHERE id = ?',
    ).bind(NOW + 600, opened.incidentId).run();
    const after = await reconcileIncidents(db(), [{ ...item, severity: 'severe', title: '高负载加重' }], NOW + 30);
    expect(after).toEqual([]);
    const row = await db().prepare(
      'SELECT severity, last_seen_at, snoozed_until FROM ops_incidents WHERE id = ?',
    ).bind(opened.incidentId).first<{ severity: string; last_seen_at: number; snoozed_until: number }>();
    expect(row?.severity).toBe('warn');
    expect(Number(row?.last_seen_at)).toBe(NOW + 30);
    expect(Number(row?.snoozed_until)).toBe(NOW + 600);
  });

  it('detaches children when the parent resolves', async () => {
    const parent = desire({
      dedupeKey: 'node-blocked:n',
      kind: 'node-blocked',
      subjectId: 'n',
      severity: 'severe',
      title: '疑似被墙',
    });
    const child = desire({
      dedupeKey: 'customer-repeat-fail:u1',
      kind: 'customer-repeat-fail',
      subjectType: 'user',
      subjectId: 'u1',
      severity: 'notice',
      title: '连续连接失败',
      parentDedupeKey: 'node-blocked:n',
    });
    await reconcileIncidents(db(), [parent, child], NOW);
    const linked = await db().prepare(
      'SELECT parent_incident_id FROM ops_incidents WHERE dedupe_key = ?',
    ).bind(child.dedupeKey).first<{ parent_incident_id: string | null }>();
    expect(linked?.parent_incident_id).toBeTruthy();

    await reconcileIncidents(db(), [child], NOW + 10);
    const standalone = await db().prepare(
      "SELECT parent_incident_id, status FROM ops_incidents WHERE dedupe_key = ?",
    ).bind(child.dedupeKey).first<{ parent_incident_id: string | null; status: string }>();
    expect(standalone?.parent_incident_id).toBeNull();
    expect(standalone?.status).not.toBe('resolved');
    const parentRow = await db().prepare(
      'SELECT status FROM ops_incidents WHERE dedupe_key = ?',
    ).bind(parent.dedupeKey).first<{ status: string }>();
    expect(parentRow?.status).toBe('resolved');
  });
});
