import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOpsCron, type OpsCronReport } from '../src/ops/cron';
import { enqueueJob } from '../src/ops/jobs';
import { type Env } from '../src/env';

const db = () => (env as unknown as Env).DB;
const NOW = 1_800_000_000;
const USER = 'u-cron';
const WINDOW = 'win-cron';

function stepMs(report: OpsCronReport) {
  return {
    flatten: report.flatten.ms,
    project: report.project.ms,
    verdicts: report.verdicts.ms,
    alerts: report.alerts.ms,
    jobs: report.jobs.ms,
    quota: report.quota.ms,
    daily: report.daily.ms,
    retention: report.retention.ms,
  };
}

async function seedWindow(receivedAt = NOW - 60) {
  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES(?, ?, 'x', 'x', 'active', 0, ?, ?)`,
  ).bind(USER, 'cron@example.com', receivedAt, receivedAt).run();
  const payload = JSON.stringify({
    schemaVersion: 1,
    kind: 'periodic_window',
    windowStartMs: receivedAt * 1000,
    windowEndMs: receivedAt * 1000 + 60_000,
    appVersion: '0.0.72',
    osVersion: 'macOS 14.4',
    osArch: 'arm64',
    uiState: 'connected',
    selectedServer: 'Tokyo · Fuji',
    catalogRevision: 3,
    eventCount: 2,
    eventsDropped: 0,
    events: [
      { ts: receivedAt * 1000, kind: 'connectBegin', node: 'Tokyo · Fuji' },
      { ts: receivedAt * 1000 + 100, kind: 'connectFail', node: 'Tokyo · Fuji', stage: 'handshake', code: 'ETIMEDOUT' },
    ],
  });
  await db().prepare(
    `INSERT INTO telemetry_windows(
       id, user_id, device_id, received_at, window_start_ms, window_end_ms,
       client_version, os_version, payload_json
     ) VALUES(?, ?, NULL, ?, ?, ?, '0.0.72', 'macOS 14.4', ?)`,
  ).bind(WINDOW, USER, receivedAt, receivedAt * 1000, receivedAt * 1000 + 60_000, payload).run();
}

async function seedAlertRule() {
  await db().prepare(
    `INSERT INTO ops_alert_rules(
       id, name, enabled, match_kind, match_subject_type, match_subject_id,
       min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds,
       channel, target, template, secret_ref, created_at, updated_at
     ) VALUES(?, ?, 1, NULL, NULL, NULL, 'notice', 0, 'open', 0, 0,
              'webhook', ?, 'slack', NULL, ?, ?)`,
  ).bind('rule-cron', 'all events', 'https://hooks.slack.com/services/test', NOW, NOW).run();
}

describe('runOpsCron', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flattens, projects, evaluates, plans an alert, expires a lease, and reports elapsed ms', async () => {
    await seedWindow();
    await seedAlertRule();
    const { job } = await enqueueJob(db(), {
      nodeName: 'Tokyo · Fuji',
      type: 'identity_sync',
      requestedBy: 'ops@example.com',
      idempotencyKey: 'cron-expire',
    }, NOW - 10);
    await db().prepare('UPDATE ops_node_jobs SET expires_at = ? WHERE id = ?').bind(NOW - 1, job.id).run();

    const report = await runOpsCron(env as unknown as Env, NOW);

    expect(report.flatten.ok).toBe(true);
    expect(report.flatten.windows).toBe(1);
    expect(report.flatten.rows).toBeGreaterThan(0);
    expect(report.project.ok).toBe(true);
    expect(report.project.windows).toBe(1);
    expect(report.verdicts.ok).toBe(true);
    expect(report.alerts.ok).toBe(true);
    expect(report.alerts.planned).toBeGreaterThan(0);
    expect(report.jobs.ok).toBe(true);
    expect(report.jobs.expired).toBe(1);
    expect(report.quota.ok).toBe(true);
    expect(report.daily.ok).toBe(true);
    expect(report.retention.ok).toBe(true);
    for (const ms of Object.values(stepMs(report))) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(ms)).toBe(true);
    }

    const events = await db().prepare(
      'SELECT COUNT(*) AS c FROM connection_events WHERE window_id = ?',
    ).bind(WINDOW).first<{ c: number }>();
    expect(Number(events?.c)).toBeGreaterThan(0);
    const status = await db().prepare(
      'SELECT selected_server, fails_30m FROM ops_customer_status WHERE user_id = ?',
    ).bind(USER).first<{ selected_server: string; fails_30m: number }>();
    expect(status?.selected_server).toBe('Tokyo · Fuji');
    expect(Number(status?.fails_30m)).toBeGreaterThan(0);
    const deliveries = await db().prepare(
      'SELECT COUNT(*) AS c FROM ops_alert_deliveries',
    ).first<{ c: number }>();
    expect(Number(deliveries?.c)).toBeGreaterThan(0);
    const expired = await db().prepare(
      'SELECT status FROM ops_node_jobs WHERE id = ?',
    ).bind(job.id).first<{ status: string }>();
    expect(expired?.status).toBe('expired');
  });

  it('keeps running later steps when one step throws', async () => {
    await seedWindow();
    await seedAlertRule();
    const { job } = await enqueueJob(db(), {
      nodeName: 'Tokyo · Fuji',
      type: 'identity_sync',
      requestedBy: 'ops@example.com',
      idempotencyKey: 'cron-throw',
    }, NOW - 10);
    await db().prepare('UPDATE ops_node_jobs SET expires_at = ? WHERE id = ?').bind(NOW - 1, job.id).run();
    await db().prepare(
      `CREATE TRIGGER test_fail_flatten BEFORE INSERT ON ops_flatten_cursor
       BEGIN SELECT RAISE(ABORT, 'flatten boom'); END`,
    ).run();

    const report = await runOpsCron(env as unknown as Env, NOW);
    expect(report.flatten.ok).toBe(false);
    expect(report.flatten.error).toMatch(/flatten boom/i);
    expect(report.project.ok).toBe(true);
    expect(report.project.windows).toBe(1);
    expect(report.verdicts.ok).toBe(true);
    expect(report.alerts.ok).toBe(true);
    expect(report.jobs.ok).toBe(true);
    expect(report.jobs.expired).toBe(1);
    expect(report.quota.ok).toBe(true);
    expect(report.daily.ok).toBe(true);
    expect(report.retention.ok).toBe(true);
    const expired = await db().prepare(
      'SELECT status FROM ops_node_jobs WHERE id = ?',
    ).bind(job.id).first<{ status: string }>();
    expect(expired?.status).toBe('expired');
  });
});
