import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { type Env } from '../src/env';
import { reconcileIncidents } from '../src/ops/evaluate';
import { runCustomerVerdictPass, toAlertTransitions } from '../src/ops/verdict-run';
import { buildVerdictInput } from '../src/ops/verdict-facts';
import { type IncidentDesire } from '../src/ops/verdict';

const db = () => (env as unknown as Env).DB;
const NOW = 1_800_000_000;

function nodeDesire(name: string): IncidentDesire {
  return {
    dedupeKey: `node-blocked:${name}`,
    kind: 'node-blocked',
    subjectType: 'node',
    subjectId: name,
    severity: 'severe',
    title: `${name} 被墙`,
    detail: null,
    cause: 'blocked',
    impactCount: 1,
    evidence: { sweep: 'LIKELY_BLOCKED' },
  };
}

describe('toAlertTransitions', () => {
  it('looks up more incidents than one statement may bind', async () => {
    const desires = Array.from({ length: 130 }, (_, i) => nodeDesire(`Node ${String(i).padStart(3, '0')}`));
    const raw = await reconcileIncidents(db(), desires, NOW);
    expect(raw).toHaveLength(130);
    const transitions = await toAlertTransitions(db(), raw);
    expect(transitions).toHaveLength(130);
    expect(new Set(transitions.map((t) => t.subjectId)).size).toBe(130);
  });
});

describe('runCustomerVerdictPass', () => {
  it('carries node incidents through without rewriting them', async () => {
    await reconcileIncidents(db(), [nodeDesire('Tokyo · Fuji')], NOW);
    const before = await db().prepare(
      'SELECT evidence_json, last_seen_at, updated_at FROM ops_incidents WHERE subject_id = ?',
    ).bind('Tokyo · Fuji').first<{ evidence_json: string; last_seen_at: number; updated_at: number }>();
    const result = await runCustomerVerdictPass(env as unknown as Env, 'nobody', NOW + 120);
    expect(result.transitions).toEqual([]);
    const after = await db().prepare(
      "SELECT status, evidence_json, last_seen_at, updated_at FROM ops_incidents WHERE subject_id = ?",
    ).bind('Tokyo · Fuji').first<{ status: string; evidence_json: string; last_seen_at: number; updated_at: number }>();
    expect(after?.status).toBe('open');
    expect(after?.evidence_json).toBe(before?.evidence_json);
    expect(JSON.parse(after?.evidence_json ?? '{}')).toEqual({ sweep: 'LIKELY_BLOCKED' });
    expect(Number(after?.last_seen_at)).toBe(Number(before?.last_seen_at));
    expect(Number(after?.updated_at)).toBe(Number(before?.updated_at));
  });
});

describe('buildVerdictInput', () => {
  it('counts as occupants only customers heard from in the last forty minutes', async () => {
    const insert = (userId: string, seen: number) => db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, updated_at)
       VALUES(?, 1, 'Tokyo · Fuji', ?, ?)`,
    ).bind(userId, seen, NOW).run();
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       VALUES('p-fuji', 'Tokyo · Fuji', 'active', ?, ?)`,
    ).bind(NOW, NOW).run();
    await insert('fresh', NOW - 5 * 60);
    await insert('gone-for-a-month', NOW - 29 * 86_400);
    const input = await buildVerdictInput(env as unknown as Env, NOW, 'all');
    const fuji = input.nodes.find((n) => n.name === 'Tokyo · Fuji');
    expect(fuji?.occupancy).toBe(1);
  });
});
