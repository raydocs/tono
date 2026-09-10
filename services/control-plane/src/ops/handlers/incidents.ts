import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import {
  DELIVERY_TRANSITIONS,
  INCIDENT_CLOSURES,
  INCIDENT_EVENT_TYPES,
  INCIDENT_STATUSES,
  SEVERITIES,
  SUBJECT_TYPES,
  assertIncident,
  assertIncidentDetail,
  type AlertDeliveryDto,
  type DeliveryTransition,
  type IncidentClosure,
  type IncidentDetailDto,
  type IncidentDto,
  type IncidentEventDto,
  type IncidentEventType,
  type IncidentStatus,
  type Severity,
  type SubjectType,
  type Tone,
} from '../contract';
import { listJobs } from '../jobs';
import { jobDto } from './nodes-data';
import {
  Actor,
  Env,
  Row,
  afterCursor,
  auditWrite,
  check,
  decodeName,
  encodeCursor,
  entityJson,
  id,
  jsonNoStore,
  jsonWithEtag,
  listJson,
  missingTable,
  now,
  nullInt,
  nullText,
  pageParams,
  parseSince,
  weakEtag,
} from './common';

function asEventType(value: unknown): IncidentEventType {
  const text = String(value ?? '');
  if ((INCIDENT_EVENT_TYPES as readonly string[]).includes(text)) return text as IncidentEventType;
  return 'note';
}

function asDeliveryTransition(value: unknown): DeliveryTransition {
  const text = String(value ?? '');
  if ((DELIVERY_TRANSITIONS as readonly string[]).includes(text)) return text as DeliveryTransition;
  return 'open';
}

function toneForSeverity(severity: string): Tone {
  if (severity === 'severe') return 'sev';
  if (severity === 'warn') return 'warn';
  return 'info';
}

function asClosure(value: unknown): IncidentClosure | null {
  const text = nullText(value);
  if (text && (INCIDENT_CLOSURES as readonly string[]).includes(text)) return text as IncidentClosure;
  return null;
}

function shanghaiClock(sec: number): string {
  return new Date((sec + 8 * 3600) * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

function evidenceList(raw: unknown, asOf: number): IncidentDto['evidence'] {
  if (raw == null || raw === '') return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  const push = (label: string, value: unknown) => ({
    label, value: typeof value === 'string' ? value : JSON.stringify(value),
    asOfSec: asOf > 0 ? asOf : null, source: 'engine' as const,
  });
  if (Array.isArray(parsed)) {
    return parsed.map((entry, i) => {
      if (entry && typeof entry === 'object' && 'label' in (entry as object) && 'value' in (entry as object)) {
        const row = entry as Record<string, unknown>;
        return {
          label: String(row.label),
          value: typeof row.value === 'string' ? row.value : JSON.stringify(row.value),
          asOfSec: nullInt(row.asOfSec) ?? (asOf > 0 ? asOf : null),
          source: 'engine' as const,
        };
      }
      return push(`evidence[${i}]`, entry);
    });
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>).map(([label, value]) => push(label, value));
  }
  return [];
}

export function incidentDto(row: Row): IncidentDto {
  const severity = String(row.severity) as Severity;
  const openedAt = Number(row.opened_at);
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    kind: String(row.kind),
    subjectType: String(row.subject_type) as SubjectType,
    subjectId: nullText(row.subject_id),
    severity,
    status: String(row.status) as IncidentStatus,
    tone: toneForSeverity(severity),
    title: String(row.title),
    summary: nullText(row.detail),
    parentIncidentId: nullText(row.parent_incident_id),
    rulesVersion: Number(row.rules_version) || 1,
    impactCount: Number(row.impact_count) || 0,
    evidence: evidenceList(row.evidence_json, Number(row.last_seen_at) || openedAt),
    openedAt,
    lastSeenAt: Number(row.last_seen_at),
    ackedAt: nullInt(row.acked_at),
    snoozedUntil: nullInt(row.snoozed_until),
    resolvedAt: nullInt(row.resolved_at),
    nextCheckAt: nullInt(row.next_check_at),
    closure: asClosure(row.closure),
  };
}

function eventDto(row: Row): IncidentEventDto {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    at: Number(row.at),
    type: asEventType(row.type),
    actor: nullText(row.actor),
    note: nullText(row.detail),
  };
}

async function loadIncident(e: Env, idValue: string): Promise<Row> {
  const row = await e.DB.prepare('SELECT * FROM ops_incidents WHERE id = ?').bind(idValue).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
  return row;
}

export async function getIncidents(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const { cursor, limit } = pageParams(url);
  const status = url.searchParams.get('status');
  const severity = url.searchParams.get('severity');
  const subjectType = url.searchParams.get('subjectType');
  const since = parseSince(url.searchParams.get('since'));
  if (status != null && status !== '' && !(INCIDENT_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
  }
  if (severity != null && severity !== '' && !(SEVERITIES as readonly string[]).includes(severity)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid severity');
  }
  if (subjectType != null && subjectType !== '' && !(SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid subjectType');
  }
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT * FROM ops_incidents
       WHERE (? = '' OR status = ?)
         AND (? = '' OR severity = ?)
         AND (? = '' OR subject_type = ?)
         AND (? = 0 OR last_seen_at >= ?)
       ORDER BY last_seen_at DESC, id DESC
       LIMIT 500`,
    ).bind(
      status ?? '', status ?? '',
      severity ?? '', severity ?? '',
      subjectType ?? '', subjectType ?? '',
      since ?? 0, since ?? 0,
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(incidentDto).filter((row) => afterCursor(cursor, String(row.lastSeenAt), row.id, 'desc'));
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.lastSeenAt), last.id) : null;
  const updatedAt = sliced[0]?.lastSeenAt ?? now();
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([updatedAt, items.length, status, severity, subjectType, since]),
    assertIncident,
  );
}

function deliveryDto(row: Row): AlertDeliveryDto {
  return {
    id: String(row.id),
    ruleId: String(row.rule_id),
    incidentId: nullText(row.incident_id),
    dedupeKey: String(row.dedupe_key),
    transition: asDeliveryTransition(row.transition),
    status: String(row.status) as AlertDeliveryDto['status'],
    channel: (nullText(row.channel) ?? 'webhook') as AlertDeliveryDto['channel'],
    target: nullText(row.target) ?? '',
    attempts: Number(row.attempts) || 0,
    error: nullText(row.error),
    at: Number(row.created_at),
    deliveredAt: nullInt(row.sent_at),
  };
}

export async function getIncident(req: Request, e: Env, rawId: string): Promise<Response> {
  const incidentId = decodeName(rawId, 'id');
  const row = await loadIncident(e, incidentId);
  const incident = incidentDto(row);
  let events: Row[] = [];
  try {
    events = (await e.DB.prepare(
      'SELECT * FROM ops_incident_events WHERE incident_id = ? ORDER BY at DESC, id DESC',
    ).bind(incidentId).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const jobs = await listJobs(e.DB, { limit: 50 });
  const jobItems = jobs.jobs.filter((job) => job.incidentId === incidentId).map(jobDto);
  let deliveries: Row[] = [];
  try {
    deliveries = (await e.DB.prepare(
      `SELECT d.*, r.channel, r.target
       FROM ops_alert_deliveries d
       JOIN ops_alert_rules r ON r.id = d.rule_id
       WHERE d.incident_id = ?
       ORDER BY d.created_at DESC, d.id DESC`,
    ).bind(incidentId).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const t = now();
  const eventsList = {
    items: events.map(eventDto), nextCursor: null as string | null, updatedAt: t, total: events.length,
  };
  const jobsList = { items: jobItems, nextCursor: null as string | null, updatedAt: t, total: jobItems.length };
  const deliveriesList = {
    items: deliveries.map(deliveryDto), nextCursor: null as string | null, updatedAt: t, total: deliveries.length,
  };
  const detail: IncidentDetailDto = { incident, events: eventsList, jobs: jobsList, deliveries: deliveriesList };
  const etag = weakEtag([incidentId, Number(row.updated_at), events.length, jobItems.length]);
  return entityJson(e, req, detail, etag, assertIncidentDetail);
}

async function writeEvent(
  e: Env, incidentId: string, type: string, actor: string, note: string | null, t: number,
): Promise<void> {
  await e.DB.prepare(
    `INSERT INTO ops_incident_events(id, incident_id, at, type, actor, detail, data_json)
     VALUES(?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(id(), incidentId, t, type, actor, note).run();
}

export async function postIncidentAck(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const incidentId = decodeName(rawId, 'id');
  const row = await loadIncident(e, incidentId);
  const t = now();
  let note: string | null = null;
  try {
    const b = await body(req, 4 * 1024);
    note = b.note == null ? null : String(b.note).slice(0, 1000);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) throw error;
  }
  await e.DB.prepare(
    `UPDATE ops_incidents SET status = 'acked', acked_at = COALESCE(acked_at, ?), acked_by = ?, updated_at = ?
     WHERE id = ? AND status = 'open'`,
  ).bind(t, actor.email, t, incidentId).run();
  await writeEvent(e, incidentId, 'acked', actor.email, note, t);
  await auditWrite(e, actor.email, 'incident.ack', 'incident', incidentId, `acked ${row.title}`);
  const updated = incidentDto(await loadIncident(e, incidentId));
  check(e, () => { assertIncident(updated); });
  return jsonNoStore(updated);
}

export async function postIncidentSnooze(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const incidentId = decodeName(rawId, 'id');
  await loadIncident(e, incidentId);
  const b = await body(req, 4 * 1024);
  const t = now();
  const maxSnooze = 7 * 86_400;
  let until: number | null = null;
  if (Number.isSafeInteger(b.until)) {
    until = Number(b.until);
  } else if (Number.isSafeInteger(b.durationSec)) {
    until = t + Number(b.durationSec);
  } else if (Number.isSafeInteger(b.seconds)) {
    const seconds = Number(b.seconds);
    if (seconds < 1 || seconds > maxSnooze) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid seconds');
    until = t + seconds;
  }
  if (until == null || until <= t) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid until');
  await e.DB.prepare(
    'UPDATE ops_incidents SET snoozed_until = ?, updated_at = ? WHERE id = ?',
  ).bind(until, t, incidentId).run();
  await writeEvent(e, incidentId, 'snoozed', actor.email, `until ${until}`, t);
  await auditWrite(e, actor.email, 'incident.snooze', 'incident', incidentId, `snoozed until ${until}`);
  const updated = incidentDto(await loadIncident(e, incidentId));
  check(e, () => { assertIncident(updated); });
  return jsonNoStore(updated);
}

export async function postIncidentResolve(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const incidentId = decodeName(rawId, 'id');
  await loadIncident(e, incidentId);
  const b = await body(req, 4 * 1024);
  rejectUnexpectedKeys(b, ['closure', 'note']);
  const closure = String(b.closure ?? '');
  if (!(INCIDENT_CLOSURES as readonly string[]).includes(closure)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid closure');
  }
  const note = b.note == null ? null : String(b.note).slice(0, 1000);
  const t = now();
  await e.DB.prepare(
    `UPDATE ops_incidents
     SET status = 'resolved', resolved_at = ?, resolve_reason = ?, closure = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(t, note, closure, t, incidentId).run();
  if (closure === 'false_positive') {
    const falseNote = note && note.trim() ? `误报：${note.trim()}` : '误报';
    await writeEvent(e, incidentId, 'note', actor.email, falseNote, t);
  }
  await writeEvent(e, incidentId, 'resolved', actor.email, note, t);
  await auditWrite(e, actor.email, 'incident.resolve', 'incident', incidentId, `${closure}${note ? `: ${note}` : ''}`);
  const updated = incidentDto(await loadIncident(e, incidentId));
  check(e, () => { assertIncident(updated); });
  return jsonNoStore(updated);
}

export async function patchIncident(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const incidentId = decodeName(rawId, 'id');
  await loadIncident(e, incidentId);
  const b = await body(req, 4 * 1024);
  rejectUnexpectedKeys(b, ['nextCheckAt']);
  if (typeof b.nextCheckAt !== 'number' || !Number.isSafeInteger(b.nextCheckAt)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid nextCheckAt');
  }
  const nextCheckAt = Number(b.nextCheckAt);
  const t = now();
  await e.DB.prepare(
    'UPDATE ops_incidents SET next_check_at = ?, updated_at = ? WHERE id = ?',
  ).bind(nextCheckAt, t, incidentId).run();
  const clock = shanghaiClock(nextCheckAt);
  await writeEvent(e, incidentId, 'note', actor.email, `下次检查 ${clock}`, t);
  await auditWrite(e, actor.email, 'incident.next_check', 'incident', incidentId, `下次检查 ${clock}`);
  const updated = incidentDto(await loadIncident(e, incidentId));
  check(e, () => { assertIncident(updated); });
  return jsonNoStore(updated);
}

export async function postIncidentNotes(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const incidentId = decodeName(rawId, 'id');
  await loadIncident(e, incidentId);
  const b = await body(req, 4 * 1024);
  const note = String(b.note ?? '').trim();
  if (!note) throw new ApiError(400, 'VALIDATION_ERROR', 'note is required');
  const t = now();
  await writeEvent(e, incidentId, 'note', actor.email, note.slice(0, 1000), t);
  await e.DB.prepare('UPDATE ops_incidents SET updated_at = ? WHERE id = ?').bind(t, incidentId).run();
  await auditWrite(e, actor.email, 'incident.note', 'incident', incidentId, note.slice(0, 200));
  const updated = incidentDto(await loadIncident(e, incidentId));
  check(e, () => { assertIncident(updated); });
  return jsonNoStore(updated);
}

export { jsonWithEtag };
