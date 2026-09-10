// Alert matching, payload shaping, and the delivery outbox.
// Pure module: the Worker does not import this yet. fetch is injected so
// tests can stub egress without touching the global.

import { chineseAlertText, incidentConsoleUrl, shapePayload } from './alerts-shape';

export { chineseAlertText, shapePayload } from './alerts-shape';

type Row = Record<string, any>;

export type AlertSeverity = 'severe' | 'warn' | 'notice';
export type IncidentPhase = 'open' | 'escalate' | 'resolve';
export type AlertChannel = 'webhook' | 'email';
export type AlertTemplate = 'generic' | 'telegram' | 'feishu' | 'slack';
export type AlertFireOn = 'open' | 'open_resolve';

export type AlertRule = {
  id: string;
  name: string;
  enabled: number;
  matchKind: string | null;
  matchSubjectType: string | null;
  matchSubjectId: string | null;
  minSeverity: AlertSeverity;
  minImpact: number;
  fireOn: AlertFireOn;
  delaySeconds: number;
  cooldownSeconds: number;
  channel: AlertChannel;
  target: string;
  template: AlertTemplate;
  secretRef: string | null;
};

export type IncidentTransition = {
  incidentId: string;
  dedupeKey: string;
  transition: IncidentPhase;
  severity: AlertSeverity;
  kind: string;
  subjectType: string;
  subjectId: string;
  title: string;
  detail: string;
  openedAt: number;
  impactCount: number;
};

export type AlertSendEnv = {
  secrets: Record<string, string>;
  allowedHosts: string;
  consoleUrl: string;
  resendApiKey?: string;
  emailFrom?: string;
  // Shaping needs title/detail/severity. Missing entries load from ops_incidents.
  incidents?: IncidentTransition[];
};

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type PlanDeliveriesResult = {
  deferred: number;
  pending: number;
  suppressed: number;
};

export type SendPendingResult = { sent: number; failed: number };

const D1_BATCH_LIMIT = 50;
const MAX_ATTEMPTS = 5;
const FETCH_TIMEOUT_MS = 5_000;
const ERROR_LIMIT = 300;
const SEVERITY_RANK: Record<AlertSeverity, number> = { notice: 0, warn: 1, severe: 2 };

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function clipError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).slice(0, ERROR_LIMIT);
}

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function batchAll(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  const out: D1Result[] = [];
  // D1 rejects a batch above 50 statements; a noisy fan-out would otherwise
  // 500 the whole planning pass and leave the outbox half-written.
  for (let i = 0; i < statements.length; i += D1_BATCH_LIMIT) {
    out.push(...await db.batch(statements.slice(i, i + D1_BATCH_LIMIT)));
  }
  return out;
}

export function ruleMatches(rule: AlertRule, t: IncidentTransition): boolean {
  if (rule.matchKind != null && rule.matchKind !== t.kind) return false;
  if (rule.matchSubjectType != null && rule.matchSubjectType !== t.subjectType) return false;
  if (rule.matchSubjectId != null && rule.matchSubjectId !== t.subjectId) return false;
  if (SEVERITY_RANK[t.severity] < SEVERITY_RANK[rule.minSeverity]) return false;
  if (t.impactCount < rule.minImpact) return false;
  // fire_on='open' is "tell me when it starts (or worsens)", not "tell me
  // when it ends". Resolve is the one transition that must opt in.
  if (t.transition === 'resolve' && rule.fireOn !== 'open_resolve') return false;
  return true;
}

export function deliveryDedupeKey(
  ruleId: string,
  incidentDedupeKey: string,
  transition: IncidentPhase,
  openedAt: number,
): string {
  // openedAt is in the key so a reopen after resolve is a new delivery,
  // while a double-fire of the same opening is not.
  return `${ruleId}:${incidentDedupeKey}:${transition}:${openedAt}`;
}

export function backoffSeconds(attempts: number): number {
  return Math.min(300 * (2 ** attempts), 3600);
}

export function isAllowedWebhookHost(url: string, allowedHostsCsv: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const allowed = new Set(
    allowedHostsCsv.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
  return allowed.has(parsed.hostname.toLowerCase());
}

export async function planDeliveries(
  db: D1Database,
  transitions: IncidentTransition[],
  rules: AlertRule[],
  nowSec: number,
): Promise<PlanDeliveriesResult> {
  const result: PlanDeliveriesResult = { deferred: 0, pending: 0, suppressed: 0 };
  const active = rules.filter((rule) => rule.enabled === 1);
  if (transitions.length === 0 || active.length === 0) return result;

  try {
    const ruleIds = [...new Set(active.map((rule) => rule.id))];
    const stateRows = await db.prepare(
      `SELECT rule_id, dedupe_key, last_sent_at FROM ops_alert_rule_state
       WHERE rule_id IN (${ruleIds.map(() => '?').join(',')})`,
    ).bind(...ruleIds).all<Row>();
    const stateAt = new Map<string, number>();
    for (const row of stateRows.results) {
      stateAt.set(`${row.rule_id}\0${row.dedupe_key}`, Number(row.last_sent_at));
    }

    const statements: D1PreparedStatement[] = [];
    const pendingIdx: number[] = [];
    for (const t of transitions) {
      for (const rule of active) {
        if (!ruleMatches(rule, t)) continue;
        const key = deliveryDedupeKey(rule.id, t.dedupeKey, t.transition, t.openedAt);
        const lastSent = stateAt.get(`${rule.id}\0${t.dedupeKey}`);
        // Cooldown is per incident, not per transition, so a flapping
        // open/close cannot mail the operator every few seconds.
        if (lastSent !== undefined && nowSec - lastSent < rule.cooldownSeconds) {
          statements.push(
            db.prepare(
              `INSERT OR IGNORE INTO ops_alert_deliveries(
                 id, rule_id, incident_id, dedupe_key, transition, status,
                 attempts, created_at
               ) VALUES(?, ?, ?, ?, ?, 'suppressed', 0, ?)`,
            ).bind(crypto.randomUUID(), rule.id, t.incidentId, `${key}:suppressed:${nowSec}`, t.transition, nowSec),
            db.prepare(
              `UPDATE ops_alert_rule_state
               SET suppressed_count = suppressed_count + 1
               WHERE rule_id = ? AND dedupe_key = ?`,
            ).bind(rule.id, t.dedupeKey),
          );
          result.suppressed += 1;
          continue;
        }
        // Persist immediately; sendPending waits until next_attempt_at.
        // The engine only emits a transition on state change, so a delay
        // that only incremented `deferred` never fired once the delay elapsed.
        const nextAttempt = t.openedAt + rule.delaySeconds;
        if (nextAttempt > nowSec) result.deferred += 1;
        pendingIdx.push(statements.length);
        statements.push(
          db.prepare(
            `INSERT OR IGNORE INTO ops_alert_deliveries(
               id, rule_id, incident_id, dedupe_key, transition, status,
               attempts, created_at, next_attempt_at
             ) VALUES(?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
          ).bind(crypto.randomUUID(), rule.id, t.incidentId, key, t.transition, nowSec, nextAttempt),
        );
      }
    }
    if (statements.length) {
      const results = await batchAll(db, statements);
      result.pending = pendingIdx.filter((i) => Number(results[i]?.meta.changes ?? 0) > 0).length;
    }
  } catch (error) {
    if (missingTable(error)) return { deferred: 0, pending: 0, suppressed: 0 };
    throw error;
  }
  return result;
}

async function lookupIncident(db: D1Database, env: AlertSendEnv, row: Row): Promise<IncidentTransition | null> {
  const id = row.incident_id == null ? null : String(row.incident_id);
  const cached = id && env.incidents?.find((item) => item.incidentId === id);
  if (cached) return cached;
  if (!id) return null;
  try {
    const inc = await db.prepare('SELECT * FROM ops_incidents WHERE id = ?').bind(id).first<Row>();
    if (!inc) return null;
    return {
      incidentId: id, dedupeKey: String(inc.dedupe_key),
      transition: String(row.transition) as IncidentPhase,
      severity: String(inc.severity) as AlertSeverity, kind: String(inc.kind),
      subjectType: String(inc.subject_type), subjectId: String(inc.subject_id),
      title: String(inc.title), detail: inc.detail == null ? '' : String(inc.detail),
      openedAt: Number(inc.opened_at), impactCount: Number(inc.impact_count) || 0,
    };
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

async function deliverEmail(
  env: AlertSendEnv,
  fetchImpl: FetchImpl,
  t: IncidentTransition,
  target: string,
  idempotencyKey: string,
): Promise<{ url: string; headers: Record<string, string>; body: string; response: Response }> {
  const from = env.emailFrom ?? '';
  const key = env.resendApiKey ?? '';
  if (key.length < 20 || from.length < 3 || !from.includes('@') || /[\r\n]/.test(from)) {
    throw new Error('email delivery is not configured');
  }
  const url = incidentConsoleUrl(env.consoleUrl, t.incidentId);
  const body = JSON.stringify({
    from,
    to: [target],
    subject: t.title.slice(0, 200),
    text: chineseAlertText(t, url),
  });
  const headers = {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
  };
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'manual',
    headers,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { url: 'https://api.resend.com/emails', headers, body, response };
}

export async function sendPending(
  db: D1Database,
  env: AlertSendEnv,
  fetchImpl: FetchImpl,
  nowSec: number,
  budget = 5,
  onlyId?: string,
): Promise<SendPendingResult> {
  const result: SendPendingResult = { sent: 0, failed: 0 };
  let rows: Row[];
  try {
    const pending = await db.prepare(
      `SELECT d.id, d.rule_id, d.incident_id, d.dedupe_key, d.transition, d.attempts,
              r.channel, r.target, r.template, r.secret_ref, r.enabled
       FROM ops_alert_deliveries d
       JOIN ops_alert_rules r ON r.id = d.rule_id
       WHERE d.status = 'pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?)
         AND (? IS NULL OR d.id = ?)
       ORDER BY d.created_at ASC, d.id ASC
       LIMIT ?`,
    ).bind(nowSec, onlyId ?? null, onlyId ?? null, budget).all<Row>();
    rows = pending.results;
  } catch (error) {
    if (missingTable(error)) return result;
    throw error;
  }

  for (const row of rows) {
    const attemptsNow = Number(row.attempts);
    const claimed = await db.prepare(
      `UPDATE ops_alert_deliveries SET attempts = attempts + 1, next_attempt_at = ?
       WHERE id = ? AND status = 'pending' AND attempts = ?`,
    ).bind(nowSec + backoffSeconds(attemptsNow), row.id, attemptsNow).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;

    const attempts = attemptsNow + 1;
    if (Number(row.enabled) !== 1) {
      await db.prepare(
        `UPDATE ops_alert_deliveries SET status = 'suppressed', next_attempt_at = NULL, error = ?
         WHERE id = ? AND attempts = ?`,
      ).bind('rule disabled', row.id, attempts).run();
      continue;
    }
    try {
      const live = row.incident_id == null
        ? null
        : await db.prepare('SELECT status, snoozed_until FROM ops_incidents WHERE id = ?')
          .bind(row.incident_id).first<Row>();
      if (live && String(live.status) === 'resolved') {
        await db.prepare(
          `UPDATE ops_alert_deliveries SET status = 'suppressed', next_attempt_at = NULL, error = ?
           WHERE id = ? AND attempts = ?`,
        ).bind('resolved before delay', row.id, attempts).run();
        continue;
      }
      const snoozedUntil = live?.snoozed_until == null ? null : Number(live.snoozed_until);
      if (snoozedUntil != null && snoozedUntil > nowSec) {
        await db.prepare(
          `UPDATE ops_alert_deliveries SET attempts = ?, next_attempt_at = ?, error = ?
           WHERE id = ? AND attempts = ?`,
        ).bind(attemptsNow, snoozedUntil, 'snoozed', row.id, attempts).run();
        continue;
      }
    } catch (error) {
      if (!missingTable(error)) throw error;
    }

    const incident = await lookupIncident(db, env, row);
    const secret = row.secret_ref ? env.secrets[String(row.secret_ref)] : undefined;
    let responseCode: number | null = null;
    let payloadSha: string | null = null;
    let errorText: string | null = null;
    let ok = false;

    try {
      if (!incident) throw new Error('incident context missing');
      if (row.secret_ref && !secret) throw new Error(`secret ${row.secret_ref} is not available`);
      const channel = String(row.channel) as AlertChannel;
      if (channel === 'email') {
        const sent = await deliverEmail(env, fetchImpl, incident, String(row.target), String(row.id));
        await sent.response.body?.cancel();
        responseCode = sent.response.status;
        payloadSha = await sha256Hex(sent.body);
        ok = sent.response.ok;
        if (!ok) errorText = `email status ${sent.response.status}`.slice(0, ERROR_LIMIT);
      } else {
        const shaped = await shapePayload(String(row.template) as AlertTemplate, incident, {
          consoleUrl: env.consoleUrl,
          target: String(row.target),
          secret,
          sentAt: nowSec,
        });
        payloadSha = await sha256Hex(shaped.body);
        if (!isAllowedWebhookHost(shaped.url, env.allowedHosts)) {
          throw new Error('webhook host is not allowlisted');
        }
        const response = await fetchImpl(shaped.url, {
          method: 'POST',
          redirect: 'manual',
          headers: shaped.headers,
          body: shaped.body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        await response.body?.cancel();
        responseCode = response.status;
        ok = response.ok;
        if (!ok) errorText = `webhook status ${response.status}`.slice(0, ERROR_LIMIT);
      }
    } catch (error) {
      errorText = clipError(error);
    }

    const terminal = !ok && attempts >= MAX_ATTEMPTS;
    const status = ok ? 'sent' : terminal ? 'failed' : 'pending';
    const nextAttempt = ok || terminal ? null : nowSec + backoffSeconds(attempts - 1);
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `UPDATE ops_alert_deliveries
         SET status = ?, sent_at = ?, next_attempt_at = ?,
             response_code = ?, error = ?, payload_sha256 = ?
         WHERE id = ? AND attempts = ?`,
      ).bind(
        status,
        ok ? nowSec : null,
        nextAttempt,
        responseCode,
        errorText,
        payloadSha,
        row.id,
        attempts,
      ),
    ];
    if (ok) {
      statements.push(
        db.prepare(
          `INSERT INTO ops_alert_rule_state(rule_id, dedupe_key, last_sent_at, suppressed_count)
           VALUES(?, ?, ?, 0)
           ON CONFLICT(rule_id, dedupe_key) DO UPDATE SET
             last_sent_at = excluded.last_sent_at,
             suppressed_count = 0`,
        ).bind(row.rule_id, incident?.dedupeKey ?? String(row.dedupe_key), nowSec),
      );
    }
    try {
      await batchAll(db, statements);
    } catch (error) {
      if (missingTable(error)) return result;
      throw error;
    }
    if (ok) result.sent += 1;
    else result.failed += 1;
  }
  return result;
}

export async function retainDeliveries(
  db: D1Database,
  nowSec: number,
  days = 90,
  limit = 500,
): Promise<number> {
  try {
    // Subquery + LIMIT so the first sweep over a backlog is not one
    // giant delete; the next scheduled pass drains the rest.
    const result = await db.prepare(
      `DELETE FROM ops_alert_deliveries WHERE id IN (
         SELECT id FROM ops_alert_deliveries
         WHERE created_at <= ?
         ORDER BY created_at ASC, id ASC
         LIMIT ?
       )`,
    ).bind(nowSec - days * 86_400, limit).run();
    return Number(result.meta.changes ?? 0);
  } catch (error) {
    if (missingTable(error)) return 0;
    throw error;
  }
}
