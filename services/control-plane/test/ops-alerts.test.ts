import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import {
  type AlertRule,
  type AlertSendEnv,
  type AlertTemplate,
  type FetchImpl,
  type IncidentTransition,
  backoffSeconds,
  chineseAlertText,
  deliveryDedupeKey,
  isAllowedWebhookHost,
  planDeliveries,
  retainDeliveries,
  ruleMatches,
  sendPending,
  shapePayload,
} from '../src/ops/alerts';
import { envSecret } from '../src/ops/verdict-run';

const db = () => (env as unknown as { DB: D1Database }).DB;
const NOW = 1_800_000_000;
const CONSOLE = 'https://ops.example.com';

const baseTransition = (over: Partial<IncidentTransition> = {}): IncidentTransition => ({
  incidentId: 'inc-1',
  dedupeKey: 'node:exit-a:down',
  transition: 'open',
  severity: 'warn',
  kind: 'node_down',
  subjectType: 'node',
  subjectId: 'exit-a',
  title: 'exit-a 不可达',
  detail: '连续三次探活失败',
  openedAt: NOW - 120,
  impactCount: 3,
  ...over,
});

const baseRule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: 'rule-1',
  name: 'node down webhook',
  enabled: 1,
  matchKind: null,
  matchSubjectType: null,
  matchSubjectId: null,
  minSeverity: 'warn',
  minImpact: 0,
  fireOn: 'open',
  delaySeconds: 0,
  cooldownSeconds: 3600,
  channel: 'webhook',
  target: 'https://hooks.example.com/in',
  template: 'generic',
  secretRef: 'WEBHOOK_SECRET',
  ...over,
});

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function shaHex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('ops alert matching', () => {
  it.each([
    ['no filters, warn meets min warn', {}, {}, true],
    ['notice below min warn', {}, { severity: 'notice' }, false],
    ['severe meets min severe', { minSeverity: 'severe' }, { severity: 'severe' }, true],
    ['warn below min severe', { minSeverity: 'severe' }, { severity: 'warn' }, false],
    ['kind mismatch', { matchKind: 'node_down' }, { kind: 'home_dead' }, false],
    ['kind match', { matchKind: 'node_down' }, { kind: 'node_down' }, true],
    ['subject type mismatch', { matchSubjectType: 'node' }, { subjectType: 'home' }, false],
    ['subject id mismatch', { matchSubjectId: 'exit-a' }, { subjectId: 'exit-b' }, false],
    ['impact below min', { minImpact: 5 }, { impactCount: 3 }, false],
    ['impact meets min', { minImpact: 3 }, { impactCount: 3 }, true],
    ['resolve gated off on fire_on=open', { fireOn: 'open' }, { transition: 'resolve' }, false],
    ['resolve allowed on fire_on=open_resolve', { fireOn: 'open_resolve' }, { transition: 'resolve' }, true],
    ['open still matches fire_on=open_resolve', { fireOn: 'open_resolve' }, { transition: 'open' }, true],
    ['escalate is not gated by fire_on', { fireOn: 'open' }, { transition: 'escalate' }, true],
  ] as Array<[string, Partial<AlertRule>, Partial<IncidentTransition>, boolean]>)(
    '%s',
    (_name, ruleOver, transOver, expected) => {
      expect(ruleMatches(baseRule(ruleOver), baseTransition(transOver))).toBe(expected);
    },
  );
});

describe('ops alert pure helpers', () => {
  it('builds a stable delivery dedupe key that changes on reopen', () => {
    const a = deliveryDedupeKey('rule-1', 'node:exit-a:down', 'open', 100);
    const b = deliveryDedupeKey('rule-1', 'node:exit-a:down', 'open', 100);
    const reopen = deliveryDedupeKey('rule-1', 'node:exit-a:down', 'open', 200);
    const resolve = deliveryDedupeKey('rule-1', 'node:exit-a:down', 'resolve', 100);
    expect(a).toBe(b);
    expect(a).not.toBe(reopen);
    expect(a).not.toBe(resolve);
  });

  it('caps exponential backoff at one hour', () => {
    expect(backoffSeconds(0)).toBe(300);
    expect(backoffSeconds(1)).toBe(600);
    expect(backoffSeconds(2)).toBe(1_200);
    expect(backoffSeconds(3)).toBe(2_400);
    expect(backoffSeconds(4)).toBe(3_600);
    expect(backoffSeconds(10)).toBe(3_600);
  });

  it('allowlist rejects http and unknown hosts', () => {
    const allowed = 'hooks.example.com, hooks.slack.com';
    expect(isAllowedWebhookHost('https://hooks.example.com/in', allowed)).toBe(true);
    expect(isAllowedWebhookHost('http://hooks.example.com/in', allowed)).toBe(false);
    expect(isAllowedWebhookHost('https://evil.example/in', allowed)).toBe(false);
    expect(isAllowedWebhookHost('not a url', allowed)).toBe(false);
  });
});

describe('ops alert payload shaping', () => {
  const t = baseTransition();
  const opts = {
    consoleUrl: CONSOLE,
    target: 'https://hooks.example.com/in',
    secret: 's3cret',
    sentAt: NOW,
  };

  it('signs the generic envelope over the raw body', async () => {
    const shaped = await shapePayload('generic', t, opts);
    expect(shaped.url).toBe(opts.target);
    const payload = JSON.parse(shaped.body);
    expect(payload).toEqual({
      version: 1,
      event: 'incident.open',
      incident: {
        id: 'inc-1',
        kind: 'node_down',
        severity: 'warn',
        subject: { type: 'node', id: 'exit-a' },
        title: t.title,
        detail: t.detail,
        openedAt: t.openedAt,
        impactCount: 3,
        url: `${CONSOLE}/incidents/inc-1`,
      },
      sentAt: NOW,
    });
    expect(shaped.headers['X-Tono-Signature']).toBe(`sha256=${await hmacHex(shaped.body, 's3cret')}`);
    expect(shaped.headers['X-Tono-Signature']).not.toBe(`sha256=${await hmacHex(shaped.body + 'x', 's3cret')}`);
  });

  it('shapes telegram without parse_mode and truncates long text', async () => {
    const long = baseTransition({ detail: '失败'.repeat(2_000) });
    const shaped = await shapePayload('telegram', long, {
      ...opts,
      target: '-100123',
      secret: '123:ABC',
    });
    expect(shaped.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    const body = JSON.parse(shaped.body) as { chat_id: string; text: string; parse_mode?: string };
    expect(body.chat_id).toBe('-100123');
    expect(body.parse_mode).toBeUndefined();
    expect(body.text.length).toBeLessThanOrEqual(3_500);
    expect(body.text.startsWith('【Tono】警告 · 触发')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'parse_mode')).toBe(false);
  });

  it('shapes feishu and slack text payloads', async () => {
    const text = chineseAlertText(t, `${CONSOLE}/incidents/inc-1`);
    const feishu = await shapePayload('feishu', t, opts);
    expect(JSON.parse(feishu.body)).toEqual({ msg_type: 'text', content: { text } });
    const slack = await shapePayload('slack', t, opts);
    expect(JSON.parse(slack.body)).toEqual({ text });
    expect(feishu.url).toBe(opts.target);
    expect(slack.url).toBe(opts.target);
  });

  it.each(['generic', 'telegram', 'feishu', 'slack'] as AlertTemplate[])(
    'keeps %s POST bodies as JSON',
    async (template) => {
      const shaped = await shapePayload(template, t, { ...opts, target: template === 'telegram' ? '-100' : opts.target });
      expect(() => JSON.parse(shaped.body)).not.toThrow();
      expect(shaped.headers['content-type']).toBe('application/json');
    },
  );
});

async function insertRule(rule: AlertRule, at = NOW): Promise<void> {
  await db().prepare(
    `INSERT INTO ops_alert_rules(
       id, name, enabled, match_kind, match_subject_type, match_subject_id,
       min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds,
       channel, target, template, secret_ref, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    rule.id, rule.name, rule.enabled, rule.matchKind, rule.matchSubjectType, rule.matchSubjectId,
    rule.minSeverity, rule.minImpact, rule.fireOn, rule.delaySeconds, rule.cooldownSeconds,
    rule.channel, rule.target, rule.template, rule.secretRef, at, at,
  ).run();
}

async function insertIncident(t: IncidentTransition, at = NOW): Promise<void> {
  await db().prepare(
    `INSERT INTO ops_incidents(
       id, dedupe_key, kind, subject_type, subject_id, severity, status, title, detail,
       rules_version, opened_at, last_seen_at, impact_count, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, 'open', ?, ?, 1, ?, ?, ?, ?)`,
  ).bind(
    t.incidentId, t.dedupeKey, t.kind, t.subjectType, t.subjectId, t.severity,
    t.title, t.detail, t.openedAt, at, t.impactCount, at,
  ).run();
}

function sendEnvFor(t: IncidentTransition, over: Partial<AlertSendEnv> = {}): AlertSendEnv {
  return {
    secrets: { WEBHOOK_SECRET: 's3cret' },
    allowedHosts: 'hooks.example.com',
    consoleUrl: CONSOLE,
    incidents: [t],
    ...over,
  };
}

async function countDeliveries(): Promise<number> {
  const row = await db().prepare('SELECT COUNT(*) AS c FROM ops_alert_deliveries').first<{ c: number }>();
  return Number(row?.c ?? 0);
}

describe('ops alert deliveries (d1)', () => {
  it('defers until delay_seconds have elapsed', async () => {
    const rule = baseRule({ delaySeconds: 60 });
    const t = baseTransition({ openedAt: NOW - 30 });
    await insertRule(rule);
    const planned = await planDeliveries(db(), [t], [rule], NOW);
    expect(planned.deferred).toBe(1);
    expect(planned.pending).toBe(0);
    expect(await countDeliveries()).toBe(0);
  });

  it('suppresses inside cooldown and bumps the counter', async () => {
    const rule = baseRule();
    const t = baseTransition();
    await insertRule(rule);
    await db().prepare(
      `INSERT INTO ops_alert_rule_state(rule_id, dedupe_key, last_sent_at, suppressed_count)
       VALUES(?, ?, ?, ?)`,
    ).bind(rule.id, t.dedupeKey, NOW - 10, 2).run();
    const planned = await planDeliveries(db(), [t], [rule], NOW);
    expect(planned.suppressed).toBe(1);
    expect(planned.pending).toBe(0);
    const delivery = await db().prepare(
      'SELECT status FROM ops_alert_deliveries',
    ).first<{ status: string }>();
    expect(delivery?.status).toBe('suppressed');
    const state = await db().prepare(
      'SELECT suppressed_count FROM ops_alert_rule_state WHERE rule_id = ?',
    ).bind(rule.id).first<{ suppressed_count: number }>();
    expect(Number(state?.suppressed_count)).toBe(3);
  });

  it('refuses a second insert of the same delivery key', async () => {
    const rule = baseRule();
    const t = baseTransition();
    await insertRule(rule);
    const first = await planDeliveries(db(), [t], [rule], NOW);
    const second = await planDeliveries(db(), [t], [rule], NOW);
    expect(first.pending).toBe(1);
    expect(second.pending).toBe(0);
    expect(await countDeliveries()).toBe(1);
  });

  it('marks a pending row sent when fetch returns 200', async () => {
    const rule = baseRule();
    const t = baseTransition();
    await insertRule(rule);
    await planDeliveries(db(), [t], [rule], NOW);
    const calls: Array<{ url: string; body: string; headers: Headers }> = [];
    const fetchImpl: FetchImpl = async (url, init) => {
      calls.push({
        url,
        body: String(init?.body ?? ''),
        headers: new Headers(init?.headers),
      });
      return new Response('ok', { status: 200 });
    };
    const sendEnv: AlertSendEnv = {
      secrets: { WEBHOOK_SECRET: 's3cret' },
      allowedHosts: 'hooks.example.com',
      consoleUrl: CONSOLE,
      incidents: [t],
    };
    const sent = await sendPending(db(), sendEnv, fetchImpl, NOW);
    expect(sent.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(rule.target);
    expect(calls[0].headers.get('X-Tono-Signature')).toMatch(/^sha256=[0-9a-f]{64}$/);
    const row = await db().prepare(
      `SELECT status, attempts, response_code, payload_sha256, sent_at
       FROM ops_alert_deliveries`,
    ).first<Record<string, any>>();
    expect(row?.status).toBe('sent');
    expect(Number(row?.response_code)).toBe(200);
    expect(Number(row?.sent_at)).toBe(NOW);
    expect(row?.payload_sha256).toBe(await shaHex(calls[0].body));
    const state = await db().prepare(
      'SELECT last_sent_at, suppressed_count FROM ops_alert_rule_state WHERE rule_id = ?',
    ).bind(rule.id).first<Record<string, any>>();
    expect(Number(state?.last_sent_at)).toBe(NOW);
    expect(Number(state?.suppressed_count)).toBe(0);
  });

  it('increments attempts and schedules backoff on failure', async () => {
    const rule = baseRule();
    const t = baseTransition();
    await insertRule(rule);
    await planDeliveries(db(), [t], [rule], NOW);
    const fetchImpl: FetchImpl = async () => new Response('nope', { status: 500 });
    const sendEnv: AlertSendEnv = {
      secrets: { WEBHOOK_SECRET: 's3cret' },
      allowedHosts: 'hooks.example.com',
      consoleUrl: CONSOLE,
      incidents: [t],
    };
    const failed = await sendPending(db(), sendEnv, fetchImpl, NOW);
    expect(failed.failed).toBe(1);
    const row = await db().prepare(
      `SELECT status, attempts, next_attempt_at, response_code FROM ops_alert_deliveries`,
    ).first<Record<string, any>>();
    expect(row?.status).toBe('pending');
    expect(Number(row?.attempts)).toBe(1);
    expect(Number(row?.response_code)).toBe(500);
    expect(Number(row?.next_attempt_at)).toBe(NOW + backoffSeconds(0));
  });

  it('deletes deliveries older than the retention window', async () => {
    const rule = baseRule();
    await insertRule(rule);
    await db().batch([
      db().prepare(
        `INSERT INTO ops_alert_deliveries(
           id, rule_id, incident_id, dedupe_key, transition, status, attempts, created_at
         ) VALUES('old', ?, 'inc-old', 'old-key', 'open', 'sent', 1, ?)`,
      ).bind(rule.id, NOW - 91 * 86_400),
      db().prepare(
        `INSERT INTO ops_alert_deliveries(
           id, rule_id, incident_id, dedupe_key, transition, status, attempts, created_at
         ) VALUES('new', ?, 'inc-new', 'new-key', 'open', 'sent', 1, ?)`,
      ).bind(rule.id, NOW - 10),
    ]);
    const deleted = await retainDeliveries(db(), NOW, 90, 500);
    expect(deleted).toBe(1);
    const left = await db().prepare(
      'SELECT id FROM ops_alert_deliveries ORDER BY id',
    ).all<{ id: string }>();
    expect(left.results.map((row) => row.id)).toEqual(['new']);
  });

  it('retries a pending delivery by loading the incident from ops_incidents', async () => {
    const rule = baseRule();
    const t = baseTransition();
    await insertRule(rule);
    await insertIncident(t);
    await planDeliveries(db(), [t], [rule], NOW);
    const first = await sendPending(
      db(), sendEnvFor(t), async () => new Response('nope', { status: 502 }), NOW,
    );
    expect(first.failed).toBe(1);
    const retry = await sendPending(
      db(),
      sendEnvFor(t, { incidents: [] }),
      async () => new Response('ok', { status: 200 }),
      NOW + backoffSeconds(0),
    );
    expect(retry.sent).toBe(1);
    const row = await db().prepare(
      'SELECT status FROM ops_alert_deliveries',
    ).first<{ status: string }>();
    expect(row?.status).toBe('sent');
  });

  it('lets a later recurrence use the real dedupe key after a cooldown suppress', async () => {
    const rule = baseRule({ cooldownSeconds: 3600 });
    const opened = baseTransition({ transition: 'open' });
    await insertRule(rule);
    const plannedOpen = await planDeliveries(db(), [opened], [rule], NOW);
    expect(plannedOpen.pending).toBe(1);
    const sent = await sendPending(
      db(), sendEnvFor(opened), async () => new Response('ok', { status: 200 }), NOW,
    );
    expect(sent.sent).toBe(1);

    const escalate = baseTransition({ transition: 'escalate', incidentId: 'inc-1' });
    const inside = await planDeliveries(db(), [escalate], [rule], NOW + 10);
    expect(inside.suppressed).toBe(1);
    expect(inside.pending).toBe(0);
    const suppressed = await db().prepare(
      "SELECT status, dedupe_key FROM ops_alert_deliveries WHERE status = 'suppressed'",
    ).first<{ status: string; dedupe_key: string }>();
    expect(suppressed?.status).toBe('suppressed');
    const realKey = deliveryDedupeKey(rule.id, escalate.dedupeKey, 'escalate', escalate.openedAt);
    expect(suppressed?.dedupe_key).not.toBe(realKey);

    const after = await planDeliveries(db(), [escalate], [rule], NOW + 4000);
    expect(after.pending).toBe(1);
    const pending = await db().prepare(
      "SELECT status, dedupe_key FROM ops_alert_deliveries WHERE status = 'pending'",
    ).first<{ status: string; dedupe_key: string }>();
    expect(pending?.status).toBe('pending');
    expect(pending?.dedupe_key).toBe(realKey);
    const resent = await sendPending(
      db(), sendEnvFor(escalate), async () => new Response('ok', { status: 200 }), NOW + 4000,
    );
    expect(resent.sent).toBe(1);
  });

  it('claims a pending row so concurrent drainers POST once', async () => {
    const rule = baseRule();
    const t = baseTransition();
    await insertRule(rule);
    await planDeliveries(db(), [t], [rule], NOW);
    const calls: string[] = [];
    let release!: (value: Response) => void;
    let started!: () => void;
    const sawFetch = new Promise<void>((resolve) => { started = resolve; });
    const fetchImpl: FetchImpl = async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        started();
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return new Response('ok', { status: 200 });
    };
    const first = sendPending(db(), sendEnvFor(t), fetchImpl, NOW);
    await sawFetch;
    const second = await sendPending(db(), sendEnvFor(t), fetchImpl, NOW);
    release(new Response('ok', { status: 200 }));
    const firstResult = await first;
    expect(calls).toHaveLength(1);
    expect(firstResult.sent + second.sent).toBe(1);
    const row = await db().prepare(
      'SELECT status FROM ops_alert_deliveries',
    ).first<{ status: string }>();
    expect(row?.status).toBe('sent');
  });
});

describe('ops alert secret refs', () => {
  it('envSecret only resolves ALERT_ worker secrets', () => {
    const secrets = {
      JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
      ADMIN_API_TOKEN: 'admin-test-token-with-at-least-32-characters',
      RESEND_API_KEY: 're_test-key-with-at-least-32-characters',
      ALERT_TELEGRAM_BOT_TOKEN: '123:ABC',
    } as unknown as Env;
    expect(envSecret(secrets, 'JWT_SECRET')).toBeUndefined();
    expect(envSecret(secrets, 'ADMIN_API_TOKEN')).toBeUndefined();
    expect(envSecret(secrets, 'RESEND_API_KEY')).toBeUndefined();
    expect(envSecret(secrets, 'ALERT_TELEGRAM_BOT_TOKEN')).toBe('123:ABC');
  });
});
