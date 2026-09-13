import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { type Env } from '../src/env';
import { encryptCatalog, sha256 } from '../src/crypto';
import { coverageOf } from '../src/ops/coverage';
import { getNodes } from '../src/ops/handlers/nodes';
import { reconcileIncidents } from '../src/ops/evaluate';
import { runCustomerVerdictPass, runNodeVerdictPass, toAlertTransitions } from '../src/ops/verdict-run';
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
  it('counts a same-node hy2 block once and retires its phantom no-probe incident', async () => {
    const e = env as unknown as Env;
    const name = 'Tokyo · Kite';
    const backup = `${name} · hy2`;
    const yaml = `proxies:
  - name: ${name}
    type: vless
    server: 9.0.0.1
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
  - name: ${backup}
    type: hysteria2
    server: 9.0.0.1
    port: 443
    password: {{TONO_CLIENT_UUID}}
    sni: www.ucla.edu
    fingerprint: ${'a'.repeat(64)}
`;
    const encrypted = await encryptCatalog(yaml, e.CATALOG_ENCRYPTION_KEY!);
    await db().prepare(
      `INSERT INTO managed_exit_catalog(singleton_id, revision, ciphertext, nonce, content_sha256, updated_at)
       VALUES(1, 1, ?, ?, ?, ?)`,
    ).bind(encrypted.ciphertext, encrypted.nonce, await sha256(yaml), NOW).run();
    // Old deployments persisted a second machine and an incident for this alias.
    await db().prepare(
      `INSERT INTO ops_node_status(node_name, verdict, label, reason, rules_version, evaluated_at, changed_at)
       VALUES(?, 'unknown', '待确认', '在售但没有探针', 2, ?, ?)`,
    ).bind(backup, NOW, NOW).run();
    await reconcileIncidents(db(), [{
      ...nodeDesire(backup), kind: 'node-no-probe', dedupeKey: `node-no-probe:${backup}`,
      severity: 'notice', cause: 'unknown', impactCount: 0,
    }], NOW);

    expect((await buildVerdictInput(e, NOW, 'none')).nodes.map((n) => n.name)).toEqual([name]);
    expect((await coverageOf(e, NOW))?.nodesListed).toBe(1);
    await runNodeVerdictPass(e, NOW + 120);
    const list = await (await getNodes(new Request('https://test/api/v1/ops/nodes'), e)).json() as { items: { name: string }[] };
    expect(list.items.map((n) => n.name)).toEqual([name]);
    expect(await db().prepare(
      "SELECT COUNT(*) AS n FROM ops_incidents WHERE subject_id = ? AND status <> 'resolved'",
    ).bind(backup).first('n')).toBe(0);
    // The base still lacks a probe: folding a transport must not assert UDP health.
    expect(await db().prepare(
      "SELECT COUNT(*) AS n FROM ops_incidents WHERE subject_id = ? AND kind = 'node-no-probe' AND status <> 'resolved'",
    ).bind(name).first('n')).toBe(1);
  });

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

  it('does not copy customer failure counts into attempts', async () => {
    await db().prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
       VALUES('u-fail', 'fail@example.com', 'x', 'y', 'active', 0, ?, ?)`,
    ).bind(NOW, NOW).run();
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, fails_30m, updated_at)
       VALUES('u-fail', 1, 'Tokyo · Fuji', ?, 3, ?)`,
    ).bind(NOW - 10, NOW).run();
    for (const [id, kind] of [
      ['ev-b1', 'connectBegin'],
      ['ev-b2', 'connectBegin'],
      ['ev-ok', 'connectOk'],
      ['ev-f1', 'connectFail'],
      ['ev-f2', 'connectFail'],
      ['ev-f3', 'connectFail'],
    ] as const) {
      await db().prepare(
        `INSERT INTO connection_events(
           id, at_ms, received_at, source, user_id, platform, kind, node
         ) VALUES(?, ?, ?, 'failure', 'u-fail', 'macos', ?, 'Tokyo · Fuji')`,
      ).bind(id, (NOW - 60) * 1000, NOW - 60, kind).run();
    }
    const input = await buildVerdictInput(env as unknown as Env, NOW, 'all');
    const row = input.customers.find((c) => c.userId === 'u-fail');
    expect(row?.fails30m).toEqual({ failures: 3 });
    expect(row?.fails30m).not.toHaveProperty('attempts');
  });

  it('marks the catalog unavailable on decrypt failure and does not treat nodes as unlisted', async () => {
    await db().prepare(
      `INSERT INTO managed_exit_catalog(singleton_id, revision, ciphertext, nonce, content_sha256, updated_at)
       VALUES(1, 1, 'not-ciphertext', 'not-nonce', 'deadbeef', ?)`,
    ).bind(NOW).run();
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       VALUES('p-ghost', 'Ghost · Box', 'active', ?, ?)`,
    ).bind(NOW, NOW).run();
    const input = await buildVerdictInput(env as unknown as Env, NOW, 'all');
    expect(input.catalogAvailable).toBe(false);
    expect(input.catalogErrorClass).toBeTruthy();
    const ghost = input.nodes.find((n) => n.name === 'Ghost · Box');
    expect(ghost?.catalogListed).toBeNull();
  });

  it('does not conjure a node out of a client event that names an exit by its id', async () => {
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
       VALUES('p-kite', 'Tokyo · Kite', 'active', ?, ?)`,
    ).bind(NOW, NOW).run();
    await db().prepare(
      `INSERT INTO connection_events(
         id, at_ms, received_at, source, user_id, platform, kind, node, stage, code
       ) VALUES(?, ?, ?, 'failure', 'u-x', 'macos', 'connectFail', ?, 'handshake', 'ETIMEDOUT')`,
    ).bind('ev-uuid', (NOW - 60) * 1000, NOW - 60, '9B20CAD5-AB18-4175-8A4C-447E8237B58D').run();
    const input = await buildVerdictInput(env as unknown as Env, NOW, 'all');
    const names = input.nodes.map((n) => n.name);
    expect(names).toContain('Tokyo · Kite');
    expect(names.some((n) => /^[0-9A-F]{8}-/.test(n))).toBe(false);
  });
});
