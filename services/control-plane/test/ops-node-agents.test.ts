import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/index';
import { ACCESS_ADMIN_EMAIL, accessAssertion, api, useWorkerHarness } from './worker-harness';

const NODE_A = 'Tokyo · Kite';
const NODE_B = 'Osaka · Gate';
const db = () => (env as unknown as { DB: D1Database }).DB;

async function seedNodes() {
  for (const [id, name] of [['p-a', NODE_A], ['p-b', NODE_B]]) {
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, public_ip, status, created_at, updated_at)
       VALUES(?, ?, '203.0.113.9', 'active', 1, 1)`,
    ).bind(id, name).run();
  }
}

async function issue(name: string, method = 'POST') {
  return api(`ops/nodes/${encodeURIComponent(name)}/agent-token`, {
    method,
    headers: { 'cf-access-jwt-assertion': await accessAssertion(ACCESS_ADMIN_EMAIL) },
  });
}

const heartbeat = (token: string, node: string, ip = '203.0.113.200') => api('node-agent/heartbeat', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'cf-connecting-ip': '198.51.100.7',
  },
  body: JSON.stringify({ node, ip, roles: ['hy2', 'xray'], agentVersion: '1.0.0' }),
});

describe('node agent self-registration', () => {
  useWorkerHarness();

  it('a node token heartbeats only its own node, never moves the profile IP, and dies on revoke', async () => {
    await seedNodes();
    const token = (await (await issue(NODE_A)).json() as { token: string }).token;
    await issue(NODE_B);

    const forged = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect((await heartbeat(forged, NODE_A)).status).toBe(401);
    expect((await heartbeat(token, NODE_B)).status).toBe(403);
    expect((await heartbeat(token, NODE_A, '::999.999.999.999')).status).toBe(400);

    expect((await heartbeat(token, NODE_A)).status).toBe(200);
    const rows = (await db().prepare(
      `SELECT node_name, reported_ip, observed_ip, roles, agent_version, last_heartbeat_at
       FROM ops_node_agents ORDER BY node_name`,
    ).all()).results;
    expect(rows).toEqual([
      { node_name: NODE_B, reported_ip: null, observed_ip: null, roles: null, agent_version: null, last_heartbeat_at: null },
      expect.objectContaining({
        node_name: NODE_A, reported_ip: '203.0.113.200', observed_ip: '198.51.100.7', roles: 'xray,hy2', agent_version: '1.0.0',
      }),
    ]);
    const ips = (await db().prepare('SELECT DISTINCT public_ip FROM ops_node_profiles').all()).results;
    expect(ips).toEqual([{ public_ip: '203.0.113.9' }]);

    const reissued = (await (await issue(NODE_A)).json() as { token: string }).token;
    expect((await heartbeat(token, NODE_A)).status).toBe(401);
    expect(await db().prepare('SELECT last_heartbeat_at, roles FROM ops_node_agents WHERE node_name = ?')
      .bind(NODE_A).first()).toEqual({ last_heartbeat_at: null, roles: null });

    const revoked = await (await issue(NODE_A, 'DELETE')).json() as { tokenRevokedAt: number };
    expect(revoked.tokenRevokedAt).toBeGreaterThan(0);
    expect(await (await issue(NODE_A, 'DELETE')).json()).toEqual({ node: NODE_A, tokenRevokedAt: revoked.tokenRevokedAt });
    expect((await issue('Nowhere · None', 'DELETE')).status).toBe(404);
    expect((await heartbeat(reissued, NODE_A)).status).toBe(403);
    expect((await db().prepare(
      "SELECT COUNT(*) AS n FROM ops_audit WHERE action = 'node.agent_token.revoke'",
    ).first())?.n).toBe(1);
  });

  it('only an owner can issue a node agent token, and issuing is audited', async () => {
    await seedNodes();
    (env as unknown as Env).OPS_ROLES = JSON.stringify({ [ACCESS_ADMIN_EMAIL]: 'operator' });
    const refused = await issue(NODE_A);
    (env as unknown as Env).OPS_ROLES = undefined;
    expect(refused.status).toBe(403);
    expect((await db().prepare('SELECT COUNT(*) AS n FROM ops_node_agents').first())?.n).toBe(0);

    const issued = await issue(NODE_A);
    expect(issued.status).toBe(201);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    const { token } = await issued.json() as { token: string };
    const stored = await db().prepare('SELECT token_hash FROM ops_node_agents').first<{ token_hash: string }>();
    expect(token).not.toContain(stored!.token_hash);
    const audit = await db().prepare(
      "SELECT actor_email FROM ops_audit WHERE action = 'node.agent_token.issue' AND target_id = ?",
    ).bind(NODE_A).first();
    expect(audit).toEqual({ actor_email: ACCESS_ADMIN_EMAIL });
  });
});
