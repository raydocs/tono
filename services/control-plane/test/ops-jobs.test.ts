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
  redactJobResult,
  validateJobRequest,
} from '../src/ops/jobs';
import { runWorkerJobs } from '../src/ops/jobs-worker';

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
    expect(redactJobResult(raw, '198.51.100.4')).toBe(
      'user [redacted] uuid=[redacted] ip=[redacted] node=198.51.100.4 [redacted]=hunter2',
    );
    const t = 1_800_000_300;
    await enqueue('node_config_snapshot', t);
    const claimed = await leaseJobs(db(), 'hub', 1, t);
    const done = await completeJob(
      db(),
      claimed.jobs[0].id,
      claimed.leaseId,
      { status: 'error', summary: raw, resultJson: { log: raw } },
      t + 1,
      '198.51.100.4',
    );
    expect(done.status).toBe('failed');
    expect(done.resultStatus).toBe('error');
    expect(done.resultSummary).not.toMatch(/ops@example.com|203\.0\.113\.9|password/i);
    expect(done.resultSummary).not.toContain(uuid);
    expect(done.resultSummary).toContain('198.51.100.4');
    expect(done.resultJson).not.toMatch(/ops@example.com|203\.0\.113\.9/i);
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
});
