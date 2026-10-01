import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { decryptCatalog, encryptCatalog, sha256 } from '../src/crypto';
import { type Env, type Row } from '../src/env';
import { ApiError } from '../src/errors';
import { splitManagedCatalogProxies } from '../src/catalog-yaml';
import {
  JOB_TYPES,
  cancelJob,
  completeJob,
  defaultIdempotencyKey,
  enqueueJob,
  expireStaleJobs,
  heartbeatJob,
  leaseJobs,
  listJobs,
  validateJobRequest,
} from '../src/ops/jobs';
import { redactJobResult } from '../src/ops/job-redaction';
import { runWorkerJobs } from '../src/ops/jobs-worker';
import { relistFleetNode, retireFleetNode } from '../src/ops/reads/fleet';
import { retirePendingDedupeKey } from '../src/ops/retire-dependencies';
import { runVerdictPass } from '../src/ops/verdict-run';
import { homeExitsResource } from '../src/ops/shared-admin/home-exits';

const db = () => (env as unknown as { DB: D1Database }).DB;

async function expectStatus(fn: () => unknown | Promise<unknown>, status: number) {
  try {
    await fn();
    throw new Error(`expected ApiError ${status}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
  }
}

async function enqueue(
  type: string,
  nowSec: number,
  extra: Partial<{ nodeName: string; params: unknown; requestedBy: string; idempotencyKey: string; incidentId: string }> = {},
) {
  return enqueueJob(db(), {
    nodeName: extra.nodeName ?? 'Tokyo · Kite',
    type,
    params: extra.params,
    requestedBy: extra.requestedBy ?? 'ops@example.com',
    incidentId: extra.incidentId,
    idempotencyKey: extra.idempotencyKey,
  }, nowSec);
}

describe('ops node jobs', () => {
  it('validates type and params', () => {
    expect(() => validateJobRequest('not_a_job', {})).toThrow(ApiError);
    expect(() => validateJobRequest('xray_restart', { extra: true })).toThrow(ApiError);
    expect(() => validateJobRequest('xray_dial_errors', { sinceMinutes: 241 })).toThrow(ApiError);
    expect(() => validateJobRequest('xray_dial_errors', { maxLines: 401 })).toThrow(ApiError);
    expect(() => validateJobRequest('node_probe', { carriers: ['att'] })).toThrow(ApiError);
    expect(() => validateJobRequest('home_line_probe', {})).toThrow(ApiError);
    expect(validateJobRequest('xray_restart', {})).toEqual({ ok: true });
    expect(validateJobRequest('xray_dial_errors', { sinceMinutes: 240, maxLines: 400 })).toEqual({ ok: true });
    expect(validateJobRequest('node_probe', { carriers: ['ct', 'cu', 'cm'] })).toEqual({ ok: true });
    expect(validateJobRequest('home_line_probe', { homeExitId: 'home-1' })).toEqual({ ok: true });
    expect(JOB_TYPES.xray_restart.destructive).toBe(true);
    expect(JOB_TYPES.xray_restart.leaseSeconds).toBe(60);
    expect(JOB_TYPES.collect_quality.leaseSeconds).toBe(600);
    expect(JOB_TYPES.node_probe.readOnly).toBe(true);
  });

  it('returns the same job on idempotent enqueue', async () => {
    const nowSec = 1_800_000_000;
    const first = await enqueue('xray_restart', nowSec, { idempotencyKey: 'same-key' });
    const second = await enqueue('xray_restart', nowSec + 10, { idempotencyKey: 'same-key' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.status).toBe('queued');
    const minute = await defaultIdempotencyKey('xray_restart', 'Tokyo · Kite', {}, 1_000);
    expect(await defaultIdempotencyKey('xray_restart', 'Tokyo · Kite', {}, 1_019)).toBe(minute);
    expect(await defaultIdempotencyKey('xray_restart', 'Tokyo · Kite', {}, 1_020)).not.toBe(minute);
    expect(await defaultIdempotencyKey('xray_restart', 'n', { b: 1, a: 2 }, 1_000))
      .toBe(await defaultIdempotencyKey('xray_restart', 'n', { a: 2, b: 1 }, 1_000));
  });

  it('leases oldest first and respects executor, not_before, and expiry', async () => {
    const t = 1_800_000_100;
    const older = await enqueue('identity_sync', t, { nodeName: 'A' });
    const newer = await enqueue('identity_sync', t + 1, { nodeName: 'B' });
    await enqueue('catalog_retire', t, { nodeName: 'C' });
    const delayed = await enqueue('agent_reinstall', t, { nodeName: 'D' });
    const expired = await enqueue('identity_sync', t, { nodeName: 'E' });
    await db().prepare('UPDATE ops_node_jobs SET not_before = ? WHERE id = ?').bind(t + 60, delayed.job.id).run();
    await db().prepare('UPDATE ops_node_jobs SET expires_at = ? WHERE id = ?').bind(t - 1, expired.job.id).run();

    const claimed = await leaseJobs(db(), 'hub', 10, t + 1);
    expect(claimed.jobs.map((job) => job.id)).toEqual([older.job.id, newer.job.id]);
    expect(claimed.jobs.every((job) => job.executor === 'hub')).toBe(true);
    expect(claimed.jobs.every((job) => job.status === 'leased')).toBe(true);
    expect(claimed.jobs.every((job) => job.leaseId === claimed.leaseId)).toBe(true);
    expect(claimed.jobs[0].attempts).toBe(1);

    const worker = await leaseJobs(db(), 'worker', 10, t + 1);
    expect(worker.jobs).toHaveLength(1);
    expect(worker.jobs[0].type).toBe('catalog_retire');
    expect(worker.jobs[0].leaseExpiresAt).toBe(t + 1 + 120);

    const tooEarly = await leaseJobs(db(), 'hub', 10, t + 1);
    expect(tooEarly.jobs).toHaveLength(0);
  });

  it('extends a lease on heartbeat and rejects a mismatched complete', async () => {
    const t = 1_800_000_200;
    await enqueue('collect_quality', t);
    const claimed = await leaseJobs(db(), 'hub', 1, t);
    expect(claimed.jobs).toHaveLength(1);
    const job = claimed.jobs[0];
    const beat = await heartbeatJob(db(), job.id, claimed.leaseId, t + 30);
    expect(beat.leaseExpiresAt).toBe(t + 30 + 600);
    expect(beat.leaseExpiresAt).toBeGreaterThan(job.leaseExpiresAt ?? 0);
    await expectStatus(
      () => completeJob(db(), job.id, 'not-this-lease', { status: 'ok', summary: 'done' }, t + 31),
      409,
    );
    const still = await db().prepare('SELECT status FROM ops_node_jobs WHERE id = ?').bind(job.id).first<{ status: string }>();
    expect(still?.status).toBe('leased');
    const done = await completeJob(db(), job.id, claimed.leaseId, { status: 'ok', summary: 'collected' }, t + 31);
    expect(done.status).toBe('succeeded');
    expect(done.resultStatus).toBe('ok');
  });

  it('redacts secrets from stored results', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const raw = `user ops@example.com uuid=${uuid} ip=203.0.113.9 node=198.51.100.4 password=hunter2`;
    const t = 1_800_000_300;
    await enqueue('node_config_snapshot', t);
    const claimed = await leaseJobs(db(), 'hub', 1, t);
    const done = await completeJob(
      db(),
      claimed.jobs[0].id,
      claimed.leaseId,
      {
        status: 'error', summary: raw,
        resultJson: JSON.stringify({
          log: raw,
          credentials: { Password: 'synthetic-assignment-value' },
          lines: ['handshake EOF Password: "two word diagnostic"; connection reset'],
        }),
      },
      t + 1,
      '198.51.100.4',
    );
    expect(done.status).toBe('failed');
    expect(done.resultStatus).toBe('error');
    expect(done.resultSummary).not.toMatch(/ops@example.com|203\.0\.113\.9|password|hunter2/i);
    expect(done.resultSummary).not.toContain(uuid);
    expect(done.resultSummary).toContain('198.51.100.4');
    expect(JSON.parse(done.resultJson!)).toEqual({
      log: 'user [redacted] uuid=[redacted] ip=[redacted] node=198.51.100.4 [redacted]',
      credentials: { '[redacted]': '[redacted]' },
      lines: ['handshake EOF [redacted]; connection reset'],
    });
    expect(redactJobResult(raw, '198.51.100.4')).toBe(
      'user [redacted] uuid=[redacted] ip=[redacted] node=198.51.100.4 [redacted]',
    );
  });

  it('requeues an expired lease then fails after max attempts', async () => {
    const t = 1_800_000_400;
    const { job } = await enqueue('xray_dial_errors', t, { params: { sinceMinutes: 15 } });
    await db().prepare('UPDATE ops_node_jobs SET max_attempts = 2 WHERE id = ?').bind(job.id).run();
    const first = await leaseJobs(db(), 'hub', 1, t);
    expect(first.jobs[0].attempts).toBe(1);
    const requeued = await expireStaleJobs(db(), (first.jobs[0].leaseExpiresAt ?? t) + 1);
    expect(requeued).toBe(1);
    const after = await db().prepare('SELECT status, attempts FROM ops_node_jobs WHERE id = ?').bind(job.id).first<Row>();
    expect(after).toMatchObject({ status: 'queued', attempts: 1 });

    const second = await leaseJobs(db(), 'hub', 1, t + 2);
    expect(second.jobs[0].attempts).toBe(2);
    const failed = await expireStaleJobs(db(), (second.jobs[0].leaseExpiresAt ?? t) + 1);
    expect(failed).toBe(1);
    const terminal = await db().prepare(
      'SELECT status, result_status, result_summary FROM ops_node_jobs WHERE id = ?',
    ).bind(job.id).first<Row>();
    expect(terminal).toMatchObject({ status: 'failed', result_status: 'timeout', result_summary: 'lease_expired' });

    const stale = await enqueue('identity_sync', t, { nodeName: 'Old' });
    await db().prepare('UPDATE ops_node_jobs SET expires_at = ? WHERE id = ?').bind(t - 1, stale.job.id).run();
    expect(await expireStaleJobs(db(), t)).toBe(1);
    const expired = await db().prepare('SELECT status FROM ops_node_jobs WHERE id = ?').bind(stale.job.id).first<Row>();
    expect(expired?.status).toBe('expired');
  });

  it('writes enqueue and result audit rows', async () => {
    const t = 1_800_000_500;
    const { job } = await enqueue('identity_sync', t, { requestedBy: 'alice@example.com' });
    const claimed = await leaseJobs(db(), 'hub', 1, t);
    await completeJob(db(), claimed.jobs[0].id, claimed.leaseId, { status: 'ok', summary: 'synced' }, t + 1);
    const audit = await db().prepare(
      'SELECT action, target_type, target_id, actor_email FROM ops_audit',
    ).all<Row>();
    const byAction = Object.fromEntries(audit.results.map((row) => [String(row.action), row]));
    expect(Object.keys(byAction).sort()).toEqual(['node.job.enqueue', 'node.job.result']);
    expect(byAction['node.job.enqueue']).toMatchObject({
      target_type: 'node',
      target_id: job.nodeName,
      actor_email: 'alice@example.com',
    });
    expect(byAction['node.job.result']).toMatchObject({ target_type: 'node_job', target_id: job.id });
    const replay = await enqueue('identity_sync', t, {
      requestedBy: 'alice@example.com',
      idempotencyKey: job.idempotencyKey,
    });
    expect(replay.created).toBe(false);
    const after = await db().prepare("SELECT COUNT(*) AS c FROM ops_audit WHERE action = 'node.job.enqueue'").first<Row>();
    expect(Number(after?.c)).toBe(1);
  });

  it('pages list results with a base64url created_at:id cursor', async () => {
    const t = 1_800_000_600;
    const a = await enqueue('identity_sync', t, { nodeName: 'N1' });
    const b = await enqueue('identity_sync', t + 1, { nodeName: 'N2' });
    const c = await enqueue('catalog_retire', t + 2, { nodeName: 'N2' });
    const first = await listJobs(db(), { limit: 2 });
    expect(first.jobs.map((job) => job.id)).toEqual([c.job.id, b.job.id]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const rest = await listJobs(db(), { cursor: first.nextCursor!, limit: 2 });
    expect(rest.jobs.map((job) => job.id)).toEqual([a.job.id]);
    expect(rest.nextCursor).toBeNull();
    const filtered = await listJobs(db(), { nodeName: 'N2', status: 'queued', executor: 'hub' });
    expect(filtered.jobs.map((job) => job.id)).toEqual([b.job.id]);
    const cancelled = await cancelJob(db(), b.job.id, 'ops@example.com', t + 3);
    expect(cancelled.status).toBe('cancelled');
  });

  it('runWorkerJobs retires a listed node, fails unknown worker types, and leaves hub jobs queued', async () => {
    const e = env as unknown as Env;
    const t = 1_800_000_700;
    const kite = 'Tokyo · Kite';
    const fuji = 'Tokyo · Fuji';
    const yaml = [
      'proxies:',
      `  - name: ${kite}`,
      '    type: vless',
      '    server: 203.0.113.9',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      `  - name: ${fuji}`,
      '    type: vless',
      '    server: 203.0.113.10',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      `      - ${kite}`,
      `      - ${fuji}`,
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const encrypted = await encryptCatalog(yaml, e.CATALOG_ENCRYPTION_KEY!);
    const digest = await sha256(yaml);
    await db().prepare(
      `INSERT INTO managed_exit_catalog(singleton_id, revision, ciphertext, nonce, content_sha256, updated_at)
       VALUES(1, 1, ?, ?, ?, ?)`,
    ).bind(encrypted.ciphertext, encrypted.nonce, digest, t).run();
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, public_ip, status, created_at, updated_at)
       VALUES('p-kite', ?, '203.0.113.9', 'active', ?, ?)`,
    ).bind(kite, t, t).run();

    const retired = await enqueue('catalog_retire', t, { nodeName: kite });
    const hub = await enqueue('identity_sync', t, { nodeName: kite, idempotencyKey: 'hub-untouched' });
    await db().prepare(
      `INSERT INTO ops_node_jobs(
         id, node_name, executor, type, params_json, status, attempts, max_attempts,
         idempotency_key, requested_by, incident_id, created_at, not_before, expires_at, updated_at
       ) VALUES('job-unknown', ?, 'worker', 'xray_restart', '{}', 'queued', 0, 3,
                'unknown-worker', 'ops@example.com', NULL, ?, ?, ?, ?)`,
    ).bind(kite, t, t, t + 900, t).run();

    const ran = await runWorkerJobs(e, t, 5);
    expect(ran).toBe(2);

    const retireRow = await db().prepare('SELECT status, result_summary FROM ops_node_jobs WHERE id = ?')
      .bind(retired.job.id).first<{ status: string; result_summary: string }>();
    expect(retireRow?.status).toBe('succeeded');
    const catalog = await db().prepare(
      'SELECT ciphertext, nonce FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<{ ciphertext: string; nonce: string }>();
    const listed = splitManagedCatalogProxies(
      await decryptCatalog(String(catalog?.ciphertext), String(catalog?.nonce), e.CATALOG_ENCRYPTION_KEY!),
    ).items.map((item) => item.name);
    expect(listed).not.toContain(kite);
    expect(listed).toContain(fuji);

    const unknown = await db().prepare('SELECT status, result_summary FROM ops_node_jobs WHERE id = ?')
      .bind('job-unknown').first<{ status: string; result_summary: string }>();
    expect(unknown?.status).toBe('failed');
    expect(String(unknown?.result_summary)).toMatch(/unknown worker job type/);

    const hubRow = await db().prepare('SELECT status FROM ops_node_jobs WHERE id = ?')
      .bind(hub.job.id).first<{ status: string }>();
    expect(hubRow?.status).toBe('queued');
  });

  async function seedTwoNodeCatalog(e: Env, t: number, kite: string, fuji: string) {
    const yaml = [
      'proxies:',
      `  - name: ${kite}`,
      '    type: vless',
      '    server: 203.0.113.9',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      `  - name: ${fuji}`,
      '    type: vless',
      '    server: 203.0.113.10',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      'proxy-groups:',
      '  - name: Tono-Exit',
      '    type: select',
      '    proxies:',
      `      - ${kite}`,
      `      - ${fuji}`,
      'rules:',
      '  - MATCH,Tono-Exit',
    ].join('\n') + '\n';
    const encrypted = await encryptCatalog(yaml, e.CATALOG_ENCRYPTION_KEY!);
    const digest = await sha256(yaml);
    await db().prepare(
      `INSERT INTO managed_exit_catalog(singleton_id, revision, ciphertext, nonce, content_sha256, updated_at)
       VALUES(1, 1, ?, ?, ?, ?)`,
    ).bind(encrypted.ciphertext, encrypted.nonce, digest, t).run();
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, public_ip, status, created_at, updated_at)
       VALUES('p-kite', ?, '203.0.113.9', 'active', ?, ?)`,
    ).bind(kite, t, t).run();
    await db().prepare(
      `INSERT INTO ops_node_profiles(id, catalog_name, public_ip, status, created_at, updated_at)
       VALUES('p-fuji', ?, '203.0.113.10', 'active', ?, ?)`,
    ).bind(fuji, t, t).run();
    return yaml;
  }

  async function seedExitToken(name: string, t: number) {
    const tokenHash = await sha256(`token-for-${name}`);
    await db().prepare(
      `INSERT INTO exit_nodes(id, name, token_hash, status, last_roster_at, created_at, updated_at)
       VALUES(?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(`exit-${name}`, name, tokenHash, t - 60, t, t).run();
    return tokenHash;
  }

  async function listedNames(e: Env): Promise<string[]> {
    const catalog = await db().prepare(
      'SELECT ciphertext, nonce FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<{ ciphertext: string; nonce: string }>();
    return splitManagedCatalogProxies(
      await decryptCatalog(String(catalog?.ciphertext), String(catalog?.nonce), e.CATALOG_ENCRYPTION_KEY!),
    ).items.map((item) => item.name);
  }

  function realityBlock(name: string, ip: string): string {
    return [
      `  - name: ${name}`,
      '    type: vless',
      `    server: ${ip}`,
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
      '    network: tcp',
      '    tls: true',
      '    flow: xtls-rprx-vision',
      '    servername: www.example.com',
      '    reality-opts:',
      `      public-key: ${'A'.repeat(43)}`,
      '      short-id: 0123abcd',
      '',
    ].join('\n');
  }

  async function exitStatus(name: string) {
    return db().prepare('SELECT status, token_hash FROM exit_nodes WHERE name = ?')
      .bind(name).first<{ status: string; token_hash: string }>();
  }

  async function retireIncident(name: string) {
    return db().prepare(
      `SELECT kind, severity, status, impact_count, dedupe_key FROM ops_incidents WHERE dedupe_key = ?`,
    ).bind(retirePendingDedupeKey(name)).first<{
      kind: string; severity: string; status: string; impact_count: number; dedupe_key: string;
    }>();
  }

  function relistBeforeRevoke(e: Env, name: string): Env {
    let relisted = false;
    const raced = new Proxy(e.DB, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key !== 'prepare') return typeof value === 'function' ? value.bind(target) : value;
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes('SET revoked_token_hash = token_hash')) return statement;
          return {
            bind: (...values: unknown[]) => ({
              run: async () => {
                if (!relisted) {
                  relisted = true;
                  await relistFleetNode(e, 'ops@example.com', name, {
                    block: realityBlock(name, '203.0.113.9'),
                  });
                }
                return statement.bind(...values).run();
              },
            }),
          };
        };
      },
    });
    return { ...e, DB: raced };
  }

  it('keeps an exit token when relist commits before direct retirement revocation', async () => {
    const e = env as unknown as Env;
    const t = 1_800_000_800;
    const kite = 'Tokyo · Kite';
    await seedTwoNodeCatalog(e, t, kite, 'Tokyo · Fuji');
    const hash = await seedExitToken(kite, t);

    await retireFleetNode(relistBeforeRevoke(e, kite), 'ops@example.com', kite, {
      expectedRevision: 1, confirmation: kite, reason: 'retire',
    }, undefined, t);

    expect(await listedNames(e)).toContain(kite);
    expect(await exitStatus(kite)).toEqual({ status: 'active', token_hash: hash });
  });

  it('keeps an exit token when relist commits before a retirement job revokes it', async () => {
    const e = env as unknown as Env;
    const t = 1_800_000_800;
    const kite = 'Tokyo · Kite';
    await seedTwoNodeCatalog(e, t, kite, 'Tokyo · Fuji');
    await retireFleetNode(e, 'ops@example.com', kite, {
      expectedRevision: 1, confirmation: kite, reason: 'retire before reenabling',
    }, undefined, t);
    const hash = await seedExitToken(kite, t);
    const { job } = await enqueue('catalog_retire', t + 1, {
      nodeName: kite, idempotencyKey: 'retire-relist-race',
    });

    expect(await runWorkerJobs(relistBeforeRevoke(e, kite), t + 1, 5)).toBe(1);

    const row = await db().prepare('SELECT status FROM ops_node_jobs WHERE id = ?')
      .bind(job.id).first<{ status: string }>();
    expect(row?.status).toBe('succeeded');
    expect(await listedNames(e)).toContain(kite);
    expect(await exitStatus(kite)).toEqual({ status: 'active', token_hash: hash });
  });

  it('refuses fleet retirement of a bound catalog home even when the customer selects another cloud node', async () => {
    const e = env as unknown as Env;
    const t = 1_800_000_980;
    const kite = 'Tokyo · Kite';
    const fuji = 'Tokyo · Fuji';
    await seedTwoNodeCatalog(e, t, kite, fuji);
    const hash = await seedExitToken(kite, t);
    await db().prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, created_at, updated_at)
       VALUES('u-home-bound', 'home-bound@example.com', 'x', 'y', ?, ?)`,
    ).bind(t, t).run();
    await db().prepare(
      `INSERT INTO home_exits(id, proxy_name, display_name, kind, status, created_at, updated_at)
       VALUES('home-kite', ?, 'Customer home', 'catalog', 'active', ?, ?)`,
    ).bind(kite, t, t).run();
    await db().prepare(
      `INSERT INTO user_home_bindings(user_id, home_exit_id, default_proxy_name, created_at, updated_at)
       VALUES('u-home-bound', 'home-kite', ?, ?, ?)`,
    ).bind(fuji, t, t).run();
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, updated_at)
       VALUES('u-home-bound', 1, ?, ?, ?)`,
    ).bind(fuji, t - 60, t).run();
    const { job } = await enqueue('catalog_retire', t, { nodeName: kite, idempotencyKey: 'retire-bound-home' });
    expect(await runWorkerJobs(e, t, 5)).toBe(1);
    const row = await db().prepare('SELECT status, result_summary FROM ops_node_jobs WHERE id = ?')
      .bind(job.id).first<{ status: string; result_summary: string }>();
    expect(row?.status).toBe('failed');
    expect(row?.result_summary).toContain('Unbind all users');
    expect(await listedNames(e)).toContain(kite);
    expect(await exitStatus(kite)).toEqual({ status: 'active', token_hash: hash });
    expect(await db().prepare('SELECT home_exit_id FROM user_home_bindings WHERE user_id = ?')
      .bind('u-home-bound').first<{ home_exit_id: string }>()).toEqual({ home_exit_id: 'home-kite' });
  });

  async function seedBindableHome(e: Env, t: number) {
    await seedTwoNodeCatalog(e, t, 'Tokyo · Kite', 'Tokyo · Fuji');
    const hash = await seedExitToken('Tokyo · Kite', t);
    await db().prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, created_at, updated_at)
       VALUES('u-home-race', 'home-race@example.com', 'x', 'y', ?, ?)`,
    ).bind(t, t).run();
    await db().prepare(
      `INSERT INTO home_exits(id, proxy_name, display_name, kind, status, created_at, updated_at)
       VALUES('home-kite', 'Tokyo · Kite', 'Customer home', 'catalog', 'active', ?, ?)`,
    ).bind(t, t).run();
    return hash;
  }

  function bindHome(e: Env) {
    return homeExitsResource(new Request('https://test/ops/users/u-home-race/home-binding', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ homeExitId: 'home-kite', defaultProxyName: 'Tokyo · Fuji' }),
    }), e, 'users/u-home-race/home-binding', 'PUT', 'ops@example.com');
  }

  it('refuses retirement when a home binding commits after preview but before its revision bump', async () => {
    const e = env as unknown as Env;
    const t = 1_800_001_100;
    const hash = await seedBindableHome(e, t);
    let boundStatus: number | undefined;
    const racingDb = new Proxy(e.DB, {
      get(target, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          let results: D1Result[] | undefined;
          const bindingDb = new Proxy(target, {
            get(bindingTarget, bindingKey) {
              if (bindingKey === 'prepare') return (sql: string) => {
                const statement = bindingTarget.prepare(sql);
                if (!sql.includes('WHERE user_home_bindings.user_id = ?')) return statement;
                return { bind: (...values: unknown[]) => ({ first: async () => {
                  results = await target.batch(statements);
                  return statement.bind(...values).first();
                } }) };
              };
              const value = Reflect.get(bindingTarget, bindingKey, bindingTarget);
              return typeof value === 'function' ? value.bind(bindingTarget) : value;
            },
          });
          boundStatus = (await bindHome({ ...e, DB: bindingDb }))?.status;
          expect(results).toBeDefined();
          return results!;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(retireFleetNode({ ...e, DB: racingDb }, 'ops@example.com', 'Tokyo · Kite', {
      expectedRevision: 1, confirmation: 'Tokyo · Kite', reason: 'race',
    }, undefined, t)).rejects.toMatchObject({ status: 409, code: 'CATALOG_CONFLICT' });
    expect(boundStatus).toBe(201);
    expect(await listedNames(e)).toContain('Tokyo · Kite');
    expect(await exitStatus('Tokyo · Kite')).toEqual({ status: 'active', token_hash: hash });
    expect(await db().prepare("SELECT status FROM ops_node_profiles WHERE catalog_name = 'Tokyo · Kite'")
      .first()).toEqual({ status: 'active' });
    expect(await db().prepare("SELECT 1 FROM ops_audit WHERE action = 'node.retire'").first()).toBeNull();
    expect(await db().prepare('SELECT home_exit_id FROM user_home_bindings WHERE user_id = ?')
      .bind('u-home-race').first()).toEqual({ home_exit_id: 'home-kite' });
  });

  it('refuses a catalog home binding when fleet retirement commits after binding preflight', async () => {
    const e = env as unknown as Env;
    const t = 1_800_001_100;
    await seedBindableHome(e, t);
    let retired = false;
    const racingDb = new Proxy(e.DB, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes('INSERT INTO user_home_bindings')) return statement;
          return { bind: (...values: unknown[]) => ({ run: async () => {
            retired = true;
            await retireFleetNode(e, 'ops@example.com', 'Tokyo · Kite', {
              expectedRevision: 1, confirmation: 'Tokyo · Kite', reason: 'race',
            }, undefined, t);
            return statement.bind(...values).run();
          } }) };
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(bindHome({ ...e, DB: racingDb })).rejects.toMatchObject({ status: 409, code: 'HOME_EXIT_INACTIVE' });
    expect(retired).toBe(true);
    expect(await listedNames(e)).not.toContain('Tokyo · Kite');
    expect((await exitStatus('Tokyo · Kite'))?.status).toBe('disabled');
    expect(await db().prepare('SELECT 1 FROM user_home_bindings WHERE user_id = ?')
      .bind('u-home-race').first()).toBeNull();
    expect(await db().prepare('SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1')
      .first()).toEqual({ revision: 2 });
    await db().prepare("UPDATE exit_nodes SET status = 'active' WHERE name = 'Tokyo · Kite'").run();
    await relistFleetNode(e, 'ops@example.com', 'Tokyo · Kite', { block: realityBlock('Tokyo · Kite', '203.0.113.9') });
    expect((await bindHome(e))?.status).toBe(201);
  });

  it('preserves the previous binding when retirement commits before a home replacement', async () => {
    const e = env as unknown as Env;
    const t = 1_800_001_100;
    await seedBindableHome(e, t);
    await db().prepare(
      `INSERT INTO home_exits(id, proxy_name, display_name, kind, status, created_at, updated_at)
       VALUES('home-old', 'Old home', 'Previous home', 'socks5', 'active', ?, ?)`,
    ).bind(t, t).run();
    await db().prepare(
      `INSERT INTO user_home_bindings(user_id, home_exit_id, created_at, updated_at)
       VALUES('u-home-race', 'home-old', ?, ?)`,
    ).bind(t, t).run();
    const racingDb = new Proxy(e.DB, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes('UPDATE user_home_bindings')) return statement;
          return { bind: (...values: unknown[]) => ({ run: async () => {
            await retireFleetNode(e, 'ops@example.com', 'Tokyo · Kite', {
              expectedRevision: 1, confirmation: 'Tokyo · Kite', reason: 'race',
            }, undefined, t);
            return statement.bind(...values).run();
          } }) };
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(bindHome({ ...e, DB: racingDb })).rejects.toMatchObject({ status: 409, code: 'HOME_EXIT_INACTIVE' });
    expect(await db().prepare('SELECT home_exit_id FROM user_home_bindings WHERE user_id = ?')
      .bind('u-home-race').first()).toEqual({ home_exit_id: 'home-old' });
    expect(await db().prepare('SELECT socks5_rotation_required_at FROM home_exits WHERE id = ?')
      .bind('home-old').first()).toEqual({ socks5_rotation_required_at: null });
    expect(await db().prepare('SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1')
      .first()).toEqual({ revision: 2 });
  });

  it('retires an empty node: catalog gone, token revoked, no incident', async () => {
    const e = env as unknown as Env;
    const t = 1_800_000_800;
    const kite = 'Tokyo · Kite';
    const fuji = 'Tokyo · Fuji';
    await seedTwoNodeCatalog(e, t, kite, fuji);
    const hash = await seedExitToken(kite, t);

    const { job } = await enqueue('catalog_retire', t, { nodeName: kite, idempotencyKey: 'retire-empty' });
    expect(await runWorkerJobs(e, t, 5)).toBe(1);

    const row = await db().prepare('SELECT status, result_summary, result_json FROM ops_node_jobs WHERE id = ?')
      .bind(job.id).first<{ status: string; result_summary: string; result_json: string }>();
    expect(row?.status).toBe('succeeded');
    expect(row?.result_summary).toBe(`retired ${kite}`);
    const result = JSON.parse(String(row?.result_json ?? '{}')) as {
      customersOnNode: unknown[]; exitTokenActive: boolean; defaultProxyBindings: number;
    };
    expect(result.customersOnNode).toEqual([]);
    expect(result.exitTokenActive).toBe(false);
    expect(result.defaultProxyBindings).toBe(0);
    expect(await listedNames(e)).not.toContain(kite);
    expect(await listedNames(e)).toContain(fuji);
    const token = await exitStatus(kite);
    expect(token?.status).toBe('disabled');
    expect(token?.token_hash).not.toBe(hash);
    expect(await retireIncident(kite)).toBeNull();
    expect(await db().prepare(
      "SELECT action FROM ops_audit WHERE action = 'node.exit_token.revoke'",
    ).first()).toBeTruthy();
  });

  it('retires with two recent customers: incident retire_pending, token kept; later drain revokes', async () => {
    const e = env as unknown as Env;
    const t = 1_800_000_900;
    const kite = 'Tokyo · Kite';
    const fuji = 'Tokyo · Fuji';
    await seedTwoNodeCatalog(e, t, kite, fuji);
    const hash = await seedExitToken(kite, t);
    await db().prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
       VALUES('u-a', 'a@example.com', 'x', 'y', 'active', 0, ?, ?),
             ('u-b', 'b@example.com', 'x', 'y', 'active', 0, ?, ?)`,
    ).bind(t, t, t, t).run();
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, updated_at)
       VALUES('u-a', 1, ?, ?, ?), ('u-b', 1, ?, ?, ?)`,
    ).bind(kite, t - 5 * 60, t, kite, t - 5 * 60, t).run();

    const first = await enqueue('catalog_retire', t, { nodeName: kite, idempotencyKey: 'retire-busy' });
    expect(await runWorkerJobs(e, t, 5)).toBe(1);
    const busy = await db().prepare('SELECT status, result_summary, result_json FROM ops_node_jobs WHERE id = ?')
      .bind(first.job.id).first<{ status: string; result_summary: string; result_json: string }>();
    expect(busy?.status).toBe('succeeded');
    expect(busy?.result_summary).toBe(`retired ${kite}: 2 位客户仍在这台机器上`);
    const busyJson = JSON.parse(String(busy?.result_json ?? '{}')) as {
      customersOnNode: Array<{ userId: string }>; exitTokenActive: boolean;
    };
    expect(busyJson.customersOnNode.map((row) => row.userId).sort()).toEqual(['u-a', 'u-b']);
    expect(busyJson.exitTokenActive).toBe(true);
    expect(await listedNames(e)).not.toContain(kite);
    expect((await exitStatus(kite))?.status).toBe('active');
    expect((await exitStatus(kite))?.token_hash).toBe(hash);
    const open = await retireIncident(kite);
    expect(open).toMatchObject({
      kind: 'retire_pending', severity: 'notice', status: 'open', impact_count: 2,
      dedupe_key: retirePendingDedupeKey(kite),
    });

    const replay = await enqueue('catalog_retire', t + 1, { nodeName: kite, idempotencyKey: 'retire-busy-again' });
    expect(await runWorkerJobs(e, t + 1, 5)).toBe(1);
    const replayRow = await db().prepare('SELECT status, result_summary FROM ops_node_jobs WHERE id = ?')
      .bind(replay.job.id).first<{ status: string; result_summary: string }>();
    expect(replayRow?.status).toBe('succeeded');
    expect(replayRow?.result_summary).toBe(`retired ${kite}: 2 位客户仍在这台机器上`);
    expect(await db().prepare(
      `SELECT COUNT(*) AS n FROM ops_incidents WHERE dedupe_key = ? AND status <> 'resolved'`,
    ).bind(retirePendingDedupeKey(kite)).first<{ n: number }>().then((row) => Number(row?.n))).toBe(1);
    expect((await exitStatus(kite))?.status).toBe('active');

    await db().prepare(
      'UPDATE ops_customer_status SET selected_server = ?, last_seen_at = ?, connected = 0',
    ).bind(fuji, t - 41 * 60).run();
    await runVerdictPass(e, t + 2);
    const cleared = await retireIncident(kite);
    expect(cleared?.status).toBe('resolved');
    expect(await runWorkerJobs(e, t + 2, 5)).toBe(0);
    expect((await exitStatus(kite))?.status).toBe('disabled');
    expect((await exitStatus(kite))?.token_hash).not.toBe(hash);

    // Relisting a revoked node is refused; the operator re-enables it and
    // deploys a newly issued token first (PATCH exit-nodes/{id}, POST …/token).
    await db().prepare("UPDATE exit_nodes SET status = 'active' WHERE name = ?").bind(kite).run();
    await relistFleetNode(e, 'ops@example.com', kite, { block: realityBlock(kite, '203.0.113.9') });
    expect(await listedNames(e)).toContain(kite);
    await runVerdictPass(e, t + 4);
    const afterRelist = await db().prepare(
      `SELECT COUNT(*) AS n FROM ops_incidents WHERE dedupe_key = ? AND status <> 'resolved'`,
    ).bind(retirePendingDedupeKey(kite)).first<{ n: number }>();
    expect(Number(afterRelist?.n)).toBe(0);
  });

  it('keeps a retiring node available while recent customers use its hy2 transport', async () => {
    const e = env as unknown as Env;
    const t = 1_800_000_950;
    const kite = 'Tokyo · Kite';
    const fuji = 'Tokyo · Fuji';
    const yaml = (await seedTwoNodeCatalog(e, t, kite, fuji)).replace('proxy-groups:', [
      `  - name: ${kite} · hy2`,
      '    type: hysteria2',
      '    server: 203.0.113.9',
      '    port: 443',
      '    password: {{TONO_CLIENT_UUID}}',
      `    fingerprint: ${'a'.repeat(64)}`,
      'proxy-groups:',
    ].join('\n'));
    const encrypted = await encryptCatalog(yaml, e.CATALOG_ENCRYPTION_KEY!);
    await db().prepare(
      'UPDATE managed_exit_catalog SET ciphertext = ?, nonce = ?, content_sha256 = ?',
    ).bind(encrypted.ciphertext, encrypted.nonce, await sha256(yaml)).run();
    const hash = await seedExitToken(kite, t);
    await db().prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, created_at, updated_at)
       VALUES('u-device', 'device@example.com', 'x', 'y', ?, ?),
             ('u-customer', 'customer@example.com', 'x', 'y', ?, ?)`,
    ).bind(t, t, t, t).run();
    await db().prepare(
      `INSERT INTO ops_device_status(user_id, device_id, connected, selected_server, last_seen_at, updated_at)
       VALUES('u-device', 'device-hy2', 1, ?, ?, ?)`,
    ).bind(`${kite} · hy2`, t - 60, t).run();
    await db().prepare(
      `INSERT INTO ops_customer_status(user_id, connected, selected_server, last_seen_at, updated_at)
       VALUES('u-customer', 1, ?, ?, ?)`,
    ).bind(`${kite} · hy2`, t - 60, t).run();

    const { job } = await enqueue('catalog_retire', t, { nodeName: kite, idempotencyKey: 'retire-hy2' });
    expect(await runWorkerJobs(e, t, 5)).toBe(1);
    const row = await db().prepare('SELECT status, result_json FROM ops_node_jobs WHERE id = ?')
      .bind(job.id).first<{ status: string; result_json: string }>();
    expect(row?.status).toBe('succeeded');
    const result = JSON.parse(String(row?.result_json)) as {
      customersOnNode: Array<{ userId: string }>; exitTokenActive: boolean;
    };
    expect(result.customersOnNode.map((customer) => customer.userId).sort())
      .toEqual(['u-customer', 'u-device']);
    expect(result.exitTokenActive).toBe(true);
    expect(await listedNames(e)).not.toContain(`${kite} · hy2`);
    expect(await exitStatus(kite)).toEqual({ status: 'active', token_hash: hash });
    expect((await retireIncident(kite))?.status).toBe('open');
    await runVerdictPass(e, t + 1);
    expect((await retireIncident(kite))?.status).toBe('open');
    expect(await exitStatus(kite)).toEqual({ status: 'active', token_hash: hash });
  });

  it('requires the complete pinned HY2 sibling when relisting a retired dual-transport node', async () => {
    const e = env as unknown as Env;
    const t = 1_800_001_050;
    const kite = 'Tokyo · Kite';
    const fingerprint = 'a'.repeat(64);
    const spki = `${'A'.repeat(43)}=`;
    const hy2Block = [
      `  - name: ${kite} · hy2`,
      '    type: hysteria2',
      '    server: 203.0.113.9',
      '    port: 443',
      '    password: {{TONO_CLIENT_UUID}}',
      '    sni: www.example.com',
      `    fingerprint: ${fingerprint}`,
      `    certificate-public-key-sha256: ${spki}`,
      '    skip-cert-verify: false',
      '',
    ].join('\n');
    const yaml = (await seedTwoNodeCatalog(e, t, kite, 'Tokyo · Fuji'))
      .replace('proxy-groups:', `${hy2Block}proxy-groups:`);
    const encrypted = await encryptCatalog(yaml, e.CATALOG_ENCRYPTION_KEY!);
    await db().prepare('UPDATE managed_exit_catalog SET ciphertext = ?, nonce = ?, content_sha256 = ?')
      .bind(encrypted.ciphertext, encrypted.nonce, await sha256(yaml)).run();
    await db().prepare('UPDATE ops_node_profiles SET hy2_port = 443, hy2_fingerprint = ? WHERE catalog_name = ?')
      .bind(fingerprint, kite).run();
    await seedExitToken(kite, t);
    await enqueue('catalog_retire', t, { nodeName: kite, idempotencyKey: 'retire-pinned-hy2' });
    expect(await runWorkerJobs(e, t, 5)).toBe(1);
    await db().prepare("UPDATE exit_nodes SET status = 'active', token_hash = ? WHERE name = ?")
      .bind(await sha256('replacement-token'), kite).run();
    const block = realityBlock(kite, '203.0.113.9');
    await expect(relistFleetNode(e, 'ops@example.com', kite, { block }))
      .rejects.toMatchObject({ status: 422, code: 'RELIST_NO_HY2_TEMPLATE' });
    expect(await db().prepare('SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1')
      .first<{ revision: number }>()).toEqual({ revision: 2 });
    const relist = await enqueue('catalog_relist', t + 1, {
      nodeName: kite, idempotencyKey: 'relist-pinned-hy2', params: { block, hy2Block, expectedRevision: 2 },
    });
    expect(await runWorkerJobs(e, t + 1, 5)).toBe(1);
    expect(await db().prepare('SELECT status FROM ops_node_jobs WHERE id = ?')
      .bind(relist.job.id).first<{ status: string }>()).toEqual({ status: 'succeeded' });
    const published = await db().prepare('SELECT revision, ciphertext, nonce FROM managed_exit_catalog WHERE singleton_id = 1')
      .first<{ revision: number; ciphertext: string; nonce: string }>();
    expect(published?.revision).toBe(3);
    const sibling = splitManagedCatalogProxies(await decryptCatalog(
      published!.ciphertext, published!.nonce, e.CATALOG_ENCRYPTION_KEY!,
    )).items.find((item) => item.name === `${kite} · hy2`);
    expect(sibling?.block).toContain(`fingerprint: ${fingerprint}`);
    expect(sibling?.block).toContain(`certificate-public-key-sha256: ${spki}`);
    expect(sibling?.block).toContain('skip-cert-verify: false');
  });

  it('rejects credential-bearing relist templates before storing job parameters', async () => {
    const block = realityBlock('Tokyo · Kite', '203.0.113.9')
      .replace('{{TONO_CLIENT_UUID}}', '123e4567-e89b-12d3-a456-426614174000');
    await expect(enqueue('catalog_relist', 1_800_001_051, { params: { block } }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(await db().prepare('SELECT COUNT(*) AS n FROM ops_node_jobs').first<{ n: number }>())
      .toEqual({ n: 0 });
  });

  it('relist refuses to publish an entry without the Reality settings clients require', async () => {
    const e = env as unknown as Env;
    const t = 1_800_001_000;
    const kite = 'Tokyo · Kite';
    await seedTwoNodeCatalog(e, t, kite, 'Tokyo · Fuji');
    await enqueue('catalog_retire', t, { nodeName: kite, idempotencyKey: 'retire-bare' });
    expect(await runWorkerJobs(e, t, 5)).toBe(1);
    const retired = await db().prepare('SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1')
      .first<{ revision: number }>();

    // The console relists with no entry; the profile holds only the address.
    const relist = await enqueue('catalog_relist', t + 1, { nodeName: kite, idempotencyKey: 'relist-bare' });
    expect(await runWorkerJobs(e, t + 1, 5)).toBe(1);
    const row = await db().prepare('SELECT status, result_summary FROM ops_node_jobs WHERE id = ?')
      .bind(relist.job.id).first<{ status: string; result_summary: string }>();
    expect(row?.status).toBe('failed');
    expect(row?.result_summary).toMatch(/No stored catalog entry/);
    const bare = `  - name: ${kite}\n    type: vless\n    server: 203.0.113.9\n    port: 443\n    uuid: {{TONO_CLIENT_UUID}}\n    tls: true\n`;
    await expect(relistFleetNode(e, 'ops@example.com', kite, { block: bare }))
      .rejects.toMatchObject({ status: 422, code: 'CATALOG_ENTRY_INCOMPLETE' });
    const after = await db().prepare('SELECT revision FROM managed_exit_catalog WHERE singleton_id = 1')
      .first<{ revision: number }>();
    expect(after?.revision).toBe(retired?.revision);
    expect(await listedNames(e)).not.toContain(kite);
  });

  it('records a change receipt after catalog_retire with incremented revision', async () => {
    const e = env as unknown as Env;
    const t = 1_800_001_000;
    const kite = 'Tokyo · Kite';
    const fuji = 'Tokyo · Fuji';
    await seedTwoNodeCatalog(e, t, kite, fuji);

    await enqueue('catalog_retire', t, { nodeName: kite, idempotencyKey: 'receipt-retire-kite' });
    expect(await runWorkerJobs(e, t, 5)).toBe(1);

    const receipt = await db().prepare(
      `SELECT kind, subject_type, subject_id, before_json, after_json, client_acks, at
       FROM ops_change_receipts
       WHERE subject_type = 'node' AND subject_id = ?`,
    ).bind(kite).first<{
      kind: string; subject_type: string; subject_id: string; before_json: string; after_json: string; client_acks: number; at: number;
    }>();

    expect(receipt).not.toBeNull();
    expect(receipt?.kind).toBe('catalog_retire');
    const before = JSON.parse(receipt?.before_json ?? '{}') as { revision: number; listed: string[] };
    const after = JSON.parse(receipt?.after_json ?? '{}') as { revision: number };
    expect(before.revision + 1).toBe(after.revision);
    expect(before.listed).toContain(kite);
  });
});
