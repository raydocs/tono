import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import {
  ALERT_CHANNELS,
  ALERT_TEMPLATES,
  INCIDENT_TRANSITIONS,
  SEVERITIES,
  SUBJECT_TYPES,
  assertAlertDelivery,
  assertAlertRule,
  type AlertChannel,
  type AlertRuleDto,
  type AlertTemplate,
  type IncidentTransition,
  type Severity,
  type SubjectType,
} from '../contract';
import { sendPending, type AlertSendEnv } from '../alerts';
import {
  Actor,
  Env,
  Row,
  auditWrite,
  check,
  decodeName,
  id,
  jsonNoStore,
  listJson,
  missingTable,
  now,
  nullInt,
  nullText,
  weakEtag,
} from './common';

function fireOnToDb(fireOn: unknown): 'open' | 'open_resolve' {
  if (Array.isArray(fireOn) && fireOn.includes('resolved')) return 'open_resolve';
  if (fireOn === 'open_resolve') return 'open_resolve';
  return 'open';
}

function fireOnFromDb(value: unknown): IncidentTransition[] {
  return String(value) === 'open_resolve'
    ? ['opened', 'escalated', 'resolved']
    : ['opened', 'escalated'];
}

function ruleDto(row: Row, lastFiredAt: number | null): AlertRuleDto {
  const matchKind = nullText(row.match_kind);
  const subject = nullText(row.match_subject_type);
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    matchKinds: matchKind ? [matchKind] : [],
    subjectType: subject && (SUBJECT_TYPES as readonly string[]).includes(subject)
      ? subject as SubjectType
      : null,
    minSeverity: String(row.min_severity) as Severity,
    minImpact: Number(row.min_impact) || 0,
    fireOn: fireOnFromDb(row.fire_on),
    delaySeconds: Number(row.delay_seconds) || 0,
    cooldownSeconds: Number(row.cooldown_seconds) || 0,
    channel: String(row.channel) as AlertChannel,
    target: String(row.target),
    template: String(row.template) as AlertTemplate,
    secretRef: nullText(row.secret_ref),
    lastFiredAt,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function lastFired(e: Env, ruleId: string): Promise<number | null> {
  try {
    const row = await e.DB.prepare(
      'SELECT MAX(last_sent_at) AS at FROM ops_alert_rule_state WHERE rule_id = ?',
    ).bind(ruleId).first<Row>();
    return nullInt(row?.at);
  } catch (error) {
    if (!missingTable(error)) throw error;
    return null;
  }
}

async function loadRule(e: Env, ruleId: string): Promise<Row> {
  const row = await e.DB.prepare('SELECT * FROM ops_alert_rules WHERE id = ?').bind(ruleId).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Alert rule not found');
  return row;
}

export async function getAlertRules(req: Request, e: Env): Promise<Response> {
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare('SELECT * FROM ops_alert_rules ORDER BY name ASC, id ASC').all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items: AlertRuleDto[] = [];
  for (const row of rows) items.push(ruleDto(row, await lastFired(e, String(row.id))));
  const updatedAt = items.reduce((max, row) => Math.max(max, row.updatedAt), now());
  return listJson(e, req, items, null, updatedAt, weakEtag([updatedAt, items.length]), assertAlertRule, items.length);
}

export async function getAlertRule(req: Request, e: Env, rawId: string): Promise<Response> {
  void req;
  const row = await loadRule(e, decodeName(rawId, 'id'));
  const dto = ruleDto(row, await lastFired(e, String(row.id)));
  check(e, () => { assertAlertRule(dto); });
  return jsonNoStore(dto);
}

function validateRuleBody(b: Record<string, unknown>, partial: boolean): void {
  if (!partial || b.channel !== undefined) {
    if (b.channel != null && !(ALERT_CHANNELS as readonly string[]).includes(String(b.channel))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid channel');
    }
  }
  if (!partial || b.template !== undefined) {
    if (b.template != null && !(ALERT_TEMPLATES as readonly string[]).includes(String(b.template))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid template');
    }
  }
  if (!partial || b.minSeverity !== undefined) {
    if (b.minSeverity != null && !(SEVERITIES as readonly string[]).includes(String(b.minSeverity))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid minSeverity');
    }
  }
}

export async function postAlertRule(req: Request, e: Env, actor: Actor): Promise<Response> {
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'name', 'enabled', 'matchKinds', 'subjectType', 'minSeverity', 'minImpact', 'fireOn',
    'delaySeconds', 'cooldownSeconds', 'channel', 'target', 'template', 'secretRef',
  ]);
  validateRuleBody(b, false);
  const t = now();
  const ruleId = id();
  const matchKinds = Array.isArray(b.matchKinds) ? b.matchKinds.map(String) : [];
  await e.DB.prepare(
    `INSERT INTO ops_alert_rules(
       id, name, enabled, match_kind, match_subject_type, match_subject_id,
       min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds,
       channel, target, template, secret_ref, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    ruleId, String(b.name), b.enabled === false ? 0 : 1,
    matchKinds[0] ?? null, b.subjectType ?? null,
    b.minSeverity ?? 'warn', Number(b.minImpact ?? 0),
    fireOnToDb(b.fireOn), Number(b.delaySeconds ?? 0), Number(b.cooldownSeconds ?? 3600),
    b.channel ?? 'webhook', String(b.target), b.template ?? 'generic',
    b.secretRef ?? null, t, t,
  ).run();
  await auditWrite(e, actor.email, 'alert-rule.create', 'alert_rule', ruleId, String(b.name));
  const dto = ruleDto(await loadRule(e, ruleId), null);
  check(e, () => { assertAlertRule(dto); });
  return jsonNoStore(dto, 201);
}

export async function patchAlertRule(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const ruleId = decodeName(rawId, 'id');
  const existing = await loadRule(e, ruleId);
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'name', 'enabled', 'matchKinds', 'subjectType', 'minSeverity', 'minImpact', 'fireOn',
    'delaySeconds', 'cooldownSeconds', 'channel', 'target', 'template', 'secretRef',
  ]);
  validateRuleBody(b, true);
  const matchKinds = b.matchKinds === undefined
    ? nullText(existing.match_kind)
    : (Array.isArray(b.matchKinds) ? (b.matchKinds.map(String)[0] ?? null) : null);
  await e.DB.prepare(
    `UPDATE ops_alert_rules SET
       name = ?, enabled = ?, match_kind = ?, match_subject_type = ?,
       min_severity = ?, min_impact = ?, fire_on = ?, delay_seconds = ?,
       cooldown_seconds = ?, channel = ?, target = ?, template = ?, secret_ref = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    b.name === undefined ? String(existing.name) : String(b.name),
    b.enabled === undefined ? Number(existing.enabled) : (b.enabled ? 1 : 0),
    matchKinds,
    b.subjectType === undefined ? existing.match_subject_type : b.subjectType,
    b.minSeverity === undefined ? String(existing.min_severity) : String(b.minSeverity),
    b.minImpact === undefined ? Number(existing.min_impact) : Number(b.minImpact),
    b.fireOn === undefined ? String(existing.fire_on) : fireOnToDb(b.fireOn),
    b.delaySeconds === undefined ? Number(existing.delay_seconds) : Number(b.delaySeconds),
    b.cooldownSeconds === undefined ? Number(existing.cooldown_seconds) : Number(b.cooldownSeconds),
    b.channel === undefined ? String(existing.channel) : String(b.channel),
    b.target === undefined ? String(existing.target) : String(b.target),
    b.template === undefined ? String(existing.template) : String(b.template),
    b.secretRef === undefined ? existing.secret_ref : b.secretRef,
    now(), ruleId,
  ).run();
  await auditWrite(e, actor.email, 'alert-rule.update', 'alert_rule', ruleId, String(b.name ?? existing.name));
  const dto = ruleDto(await loadRule(e, ruleId), await lastFired(e, ruleId));
  check(e, () => { assertAlertRule(dto); });
  return jsonNoStore(dto);
}

export async function deleteAlertRule(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  void req;
  const ruleId = decodeName(rawId, 'id');
  const existing = await loadRule(e, ruleId);
  await e.DB.prepare('DELETE FROM ops_alert_rules WHERE id = ?').bind(ruleId).run();
  await auditWrite(e, actor.email, 'alert-rule.delete', 'alert_rule', ruleId, String(existing.name));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function postAlertRuleTest(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  void req;
  const ruleId = decodeName(rawId, 'id');
  const rule = await loadRule(e, ruleId);
  const t = now();
  const deliveryId = id();
  const incidentId = `test:${ruleId}`;
  await e.DB.prepare(
    `INSERT INTO ops_alert_deliveries(
       id, rule_id, incident_id, dedupe_key, transition, status, attempts, created_at, next_attempt_at
     ) VALUES(?, ?, ?, ?, 'test', 'pending', 0, ?, ?)`,
  ).bind(deliveryId, ruleId, incidentId, `${ruleId}:test:${t}`, t, t).run();
  const sendEnv: AlertSendEnv = {
    secrets: {},
    allowedHosts: (e as Env & { OPS_ALERT_ALLOWED_HOSTS?: string }).OPS_ALERT_ALLOWED_HOSTS
      ?? (() => { try { return new URL(String(rule.target)).hostname; } catch { return ''; } })(),
    consoleUrl: 'https://ops.local',
    resendApiKey: (e as Env & { RESEND_API_KEY?: string }).RESEND_API_KEY,
    emailFrom: (e as Env & { EMAIL_FROM?: string }).EMAIL_FROM,
    incidents: [{
      incidentId, dedupeKey: `test:${ruleId}`, transition: 'open',
      severity: String(rule.min_severity) as 'severe' | 'warn' | 'notice',
      kind: 'test', subjectType: String(rule.match_subject_type ?? 'fleet'),
      subjectId: 'test', title: `test ${rule.name}`, detail: 'operator test delivery',
      openedAt: t, impactCount: 0,
    }],
  };
  await sendPending(e.DB, sendEnv, fetch, t);
  await auditWrite(e, actor.email, 'alert-rule.test', 'alert_rule', ruleId, String(rule.name));
  const dto = ruleDto(await loadRule(e, ruleId), await lastFired(e, ruleId));
  check(e, () => { assertAlertRule(dto); });
  return jsonNoStore(dto);
}

const OPEN_MAP: Record<string, IncidentTransition> = {
  open: 'opened', escalate: 'escalated', resolve: 'resolved', test: 'noted',
};

export async function getAlertDeliveries(req: Request, e: Env): Promise<Response> {
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT d.*, r.channel, r.target
       FROM ops_alert_deliveries d
       JOIN ops_alert_rules r ON r.id = d.rule_id
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 200`,
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map((row) => ({
    id: String(row.id),
    ruleId: String(row.rule_id),
    incidentId: nullText(row.incident_id),
    dedupeKey: String(row.dedupe_key),
    transition: OPEN_MAP[String(row.transition)] ?? 'noted',
    status: String(row.status) as 'pending' | 'sent' | 'failed' | 'suppressed',
    channel: (nullText(row.channel) ?? 'webhook') as AlertChannel,
    target: nullText(row.target) ?? '',
    attempts: Number(row.attempts) || 0,
    error: nullText(row.error),
    at: Number(row.created_at),
    deliveredAt: nullInt(row.sent_at),
  }));
  const updatedAt = items[0]?.at ?? now();
  return listJson(e, req, items, null, updatedAt, weakEtag([updatedAt, items.length]), assertAlertDelivery, items.length);
}

void INCIDENT_TRANSITIONS;
