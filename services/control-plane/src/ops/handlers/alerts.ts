import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import {
  ALERT_CHANNELS,
  ALERT_FIRE_ON,
  ALERT_TEMPLATES,
  DELIVERY_TRANSITIONS,
  SEVERITIES,
  assertAlertDelivery,
  assertAlertRule,
  type AlertChannel,
  type AlertFireOn,
  type AlertRuleDto,
  type AlertTemplate,
  type DeliveryTransition,
  type Severity,
} from '../contract';
import {
  DEFAULT_ALERT_ALLOWED_HOSTS,
  isAllowedWebhookHost,
  sendPending,
  type AlertSendEnv,
} from '../alerts';
import { envSecret } from '../verdict-run';
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

function allowedHostsOf(e: Env): string {
  return e.ALERT_WEBHOOK_ALLOWED_HOSTS ?? DEFAULT_ALERT_ALLOWED_HOSTS;
}

function secretsFromEnv(e: Env, secretRef: string | null): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (!secretRef) return secrets;
  const value = envSecret(e, secretRef);
  if (value) secrets[secretRef] = value;
  return secrets;
}

function parseRuleInt(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  return value;
}

function parseSecretRef(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value === '' || !/^ALERT_[A-Z0-9_]+$/.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid secretRef');
  }
  return value;
}

function assertWebhookTarget(channel: string, template: string, target: string, allowedHosts: string): void {
  if (channel === 'email') return;
  const url = template === 'telegram' ? 'https://api.telegram.org/' : target;
  if (!isAllowedWebhookHost(url, allowedHosts)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'webhook host is not allowlisted');
  }
}

function asFireOn(value: unknown): AlertFireOn {
  const text = String(value ?? 'open');
  if ((ALERT_FIRE_ON as readonly string[]).includes(text)) return text as AlertFireOn;
  return 'open';
}

function asDeliveryTransition(value: unknown): DeliveryTransition {
  const text = String(value ?? '');
  if ((DELIVERY_TRANSITIONS as readonly string[]).includes(text)) return text as DeliveryTransition;
  return 'open';
}

function ruleDto(row: Row, lastFiredAt: number | null): AlertRuleDto {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Number(row.enabled) === 1,
    matchKind: nullText(row.match_kind),
    matchSubjectType: nullText(row.match_subject_type),
    matchSubjectId: nullText(row.match_subject_id),
    minSeverity: String(row.min_severity) as Severity,
    minImpact: Number(row.min_impact) || 0,
    fireOn: asFireOn(row.fire_on),
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
      `SELECT MAX(last_sent_at) AS at FROM ops_alert_rule_state
       WHERE rule_id = ? AND dedupe_key NOT LIKE 'test:%'`,
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
  if (!partial || b.fireOn !== undefined) {
    if (b.fireOn != null && !(ALERT_FIRE_ON as readonly string[]).includes(String(b.fireOn))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid fireOn');
    }
  }
  if (!partial || b.secretRef !== undefined) parseSecretRef(b.secretRef);
  if (!partial || b.minImpact !== undefined) {
    if (b.minImpact !== undefined) parseRuleInt(b.minImpact, 'minImpact', 0, Number.MAX_SAFE_INTEGER);
  }
  if (!partial || b.delaySeconds !== undefined) {
    if (b.delaySeconds !== undefined) parseRuleInt(b.delaySeconds, 'delaySeconds', 0, 86_400);
  }
  if (!partial || b.cooldownSeconds !== undefined) {
    if (b.cooldownSeconds !== undefined) parseRuleInt(b.cooldownSeconds, 'cooldownSeconds', 0, 604_800);
  }
}

export async function postAlertRule(req: Request, e: Env, actor: Actor): Promise<Response> {
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'name', 'enabled', 'matchKind', 'matchSubjectType', 'matchSubjectId',
    'minSeverity', 'minImpact', 'fireOn',
    'delaySeconds', 'cooldownSeconds', 'channel', 'target', 'template', 'secretRef',
  ]);
  validateRuleBody(b, false);
  const channel = String(b.channel ?? 'webhook');
  const template = String(b.template ?? 'generic');
  const target = String(b.target);
  assertWebhookTarget(channel, template, target, allowedHostsOf(e));
  const t = now();
  const ruleId = id();
  await e.DB.prepare(
    `INSERT INTO ops_alert_rules(
       id, name, enabled, match_kind, match_subject_type, match_subject_id,
       min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds,
       channel, target, template, secret_ref, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    ruleId, String(b.name), b.enabled === false ? 0 : 1,
    b.matchKind ?? null, b.matchSubjectType ?? null, b.matchSubjectId ?? null,
    b.minSeverity ?? 'warn', b.minImpact === undefined ? 0 : parseRuleInt(b.minImpact, 'minImpact', 0, Number.MAX_SAFE_INTEGER),
    asFireOn(b.fireOn),
    b.delaySeconds === undefined ? 0 : parseRuleInt(b.delaySeconds, 'delaySeconds', 0, 86_400),
    b.cooldownSeconds === undefined ? 3600 : parseRuleInt(b.cooldownSeconds, 'cooldownSeconds', 0, 604_800),
    channel, target, template,
    b.secretRef === undefined ? null : parseSecretRef(b.secretRef), t, t,
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
    'name', 'enabled', 'matchKind', 'matchSubjectType', 'matchSubjectId',
    'minSeverity', 'minImpact', 'fireOn',
    'delaySeconds', 'cooldownSeconds', 'channel', 'target', 'template', 'secretRef',
  ]);
  validateRuleBody(b, true);
  const channel = String(b.channel === undefined ? existing.channel : b.channel);
  const template = String(b.template === undefined ? existing.template : b.template);
  const target = String(b.target === undefined ? existing.target : b.target);
  assertWebhookTarget(channel, template, target, allowedHostsOf(e));
  await e.DB.prepare(
    `UPDATE ops_alert_rules SET
       name = ?, enabled = ?, match_kind = ?, match_subject_type = ?, match_subject_id = ?,
       min_severity = ?, min_impact = ?, fire_on = ?, delay_seconds = ?,
       cooldown_seconds = ?, channel = ?, target = ?, template = ?, secret_ref = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    b.name === undefined ? String(existing.name) : String(b.name),
    b.enabled === undefined ? Number(existing.enabled) : (b.enabled ? 1 : 0),
    b.matchKind === undefined ? existing.match_kind : b.matchKind,
    b.matchSubjectType === undefined ? existing.match_subject_type : b.matchSubjectType,
    b.matchSubjectId === undefined ? existing.match_subject_id : b.matchSubjectId,
    b.minSeverity === undefined ? String(existing.min_severity) : String(b.minSeverity),
    b.minImpact === undefined ? Number(existing.min_impact) : parseRuleInt(b.minImpact, 'minImpact', 0, Number.MAX_SAFE_INTEGER),
    b.fireOn === undefined ? String(existing.fire_on) : asFireOn(b.fireOn),
    b.delaySeconds === undefined ? Number(existing.delay_seconds) : parseRuleInt(b.delaySeconds, 'delaySeconds', 0, 86_400),
    b.cooldownSeconds === undefined ? Number(existing.cooldown_seconds) : parseRuleInt(b.cooldownSeconds, 'cooldownSeconds', 0, 604_800),
    channel, target, template,
    b.secretRef === undefined ? existing.secret_ref : parseSecretRef(b.secretRef),
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
  ).bind(deliveryId, ruleId, incidentId, `${ruleId}:test:${deliveryId}`, t, t).run();
  const sendEnv: AlertSendEnv = {
    secrets: secretsFromEnv(e, nullText(rule.secret_ref)),
    allowedHosts: allowedHostsOf(e),
    consoleUrl: 'https://ops.local',
    resendApiKey: e.RESEND_API_KEY,
    emailFrom: e.EMAIL_FROM,
    incidents: [{
      incidentId, dedupeKey: `test:${ruleId}`, transition: 'open',
      severity: String(rule.min_severity) as 'severe' | 'warn' | 'notice',
      kind: 'test', subjectType: String(rule.match_subject_type ?? 'fleet'),
      subjectId: 'test', title: `test ${rule.name}`, detail: 'operator test delivery',
      openedAt: t, impactCount: 0,
    }],
  };
  await sendPending(e.DB, sendEnv, fetch, t, 5, deliveryId);
  await auditWrite(e, actor.email, 'alert-rule.test', 'alert_rule', ruleId, String(rule.name));
  const dto = ruleDto(await loadRule(e, ruleId), await lastFired(e, ruleId));
  check(e, () => { assertAlertRule(dto); });
  return jsonNoStore(dto);
}

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
    transition: asDeliveryTransition(row.transition),
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
