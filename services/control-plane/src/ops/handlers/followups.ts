import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import {
  FOLLOWUP_KINDS,
  assertDigest,
  assertFollowup,
  type DigestDto,
  type FollowupDto,
  type FollowupKind,
  type FollowupSubjectType,
} from '../contract';
import { incidentDto } from './incidents';
import { emptyWorthwhile, weeklyPicks, weeklyWorthwhile } from '../worthwhile';

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
  listJson,
  missingTable,
  now,
  nullInt,
  nullText,
  pageParams,
  weakEtag,
} from './common';

const BODY_MAX = 2000;
const DUE_FILTERS = ['today', 'overdue', 'open'] as const;
type DueFilter = (typeof DUE_FILTERS)[number];
const SHANGHAI_OFFSET = 8 * 3600;
const DAY = 86_400;
const FOLLOWUP_CAP = 200;
const DIGEST_CAP = 200;

export function followupDto(row: Row): FollowupDto {
  return {
    id: String(row.id),
    subjectType: String(row.subject_type) as FollowupSubjectType,
    subjectId: String(row.subject_id),
    kind: String(row.kind) as FollowupKind,
    body: String(row.body),
    dueAt: nullInt(row.due_at),
    doneAt: nullInt(row.done_at),
    createdBy: nullText(row.created_by),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function shanghaiDateString(nowSec: number): string {
  return new Date((nowSec + SHANGHAI_OFFSET) * 1000).toISOString().slice(0, 10);
}

export function shanghaiDayStart(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid day');
  }
  const startMs = Date.parse(`${day}T00:00:00+08:00`);
  if (!Number.isFinite(startMs)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid day');
  const start = Math.floor(startMs / 1000);
  if (shanghaiDateString(start) !== day) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid day');
  return start;
}

function parseKind(value: unknown): FollowupKind {
  const text = String(value ?? '');
  if (!(FOLLOWUP_KINDS as readonly string[]).includes(text)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid kind');
  }
  return text as FollowupKind;
}

function parseBody(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'body is required');
  const bodyText = value.trim();
  if (!bodyText || bodyText.length > BODY_MAX) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid body');
  }
  return bodyText;
}

function parseDueAt(value: unknown, required = false): number | null {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid dueAt');
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid dueAt');
  }
  return value;
}

async function loadUser(e: Env, userId: string): Promise<void> {
  const user = await e.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first<Row>();
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
}

async function loadFollowup(e: Env, followupId: string): Promise<Row> {
  const row = await e.DB.prepare('SELECT * FROM ops_followups WHERE id = ?').bind(followupId).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Followup not found');
  return row;
}

async function insertFollowup(
  e: Env,
  actor: Actor,
  subjectType: FollowupSubjectType,
  subjectId: string,
  kind: FollowupKind,
  bodyText: string,
  dueAt: number | null,
): Promise<FollowupDto> {
  const t = now();
  const followupId = id();
  await e.DB.prepare(
    `INSERT INTO ops_followups(
       id, subject_type, subject_id, kind, body, due_at, done_at, created_by, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).bind(followupId, subjectType, subjectId, kind, bodyText, dueAt, actor.email, t, t).run();
  await auditWrite(e, actor.email, 'followup.create', 'followup', followupId, `${kind} on ${subjectType} ${subjectId}`);
  const dto = followupDto(await loadFollowup(e, followupId));
  check(e, () => { assertFollowup(dto); });
  return dto;
}

export async function getCustomerFollowups(req: Request, e: Env, rawId: string): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  await loadUser(e, userId);
  const { cursor, limit } = pageParams(new URL(req.url));
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT * FROM ops_followups
       WHERE subject_type = 'user' AND subject_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 500`,
    ).bind(userId).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(followupDto).filter((row) => afterCursor(cursor, String(row.createdAt), row.id, 'desc'));
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.createdAt), last.id) : null;
  const updatedAt = sliced[0]?.updatedAt ?? now();
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([userId, updatedAt, items.length]),
    assertFollowup,
  );
}

export async function postCustomerFollowup(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const userId = decodeName(rawId, 'id');
  await loadUser(e, userId);
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, ['kind', 'body', 'dueAt']);
  const dto = await insertFollowup(e, actor, 'user', userId, parseKind(b.kind), parseBody(b.body), parseDueAt(b.dueAt));
  return jsonNoStore(dto, 201);
}

export async function postIncidentFollowup(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const incidentId = decodeName(rawId, 'id');
  const incident = await e.DB.prepare('SELECT id FROM ops_incidents WHERE id = ?').bind(incidentId).first<Row>();
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, ['kind', 'body', 'dueAt']);
  const dto = await insertFollowup(
    e, actor, 'incident', incidentId, parseKind(b.kind), parseBody(b.body), parseDueAt(b.dueAt),
  );
  return jsonNoStore(dto, 201);
}

export async function patchFollowup(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const followupId = decodeName(rawId, 'id');
  const row = await loadFollowup(e, followupId);
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, ['done', 'body', 'dueAt']);
  if (b.done === undefined && b.body === undefined && b.dueAt === undefined) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Nothing to update');
  }
  if (b.done !== undefined && typeof b.done !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid done');
  }
  const t = now();
  const bodyText = b.body === undefined ? String(row.body) : parseBody(b.body);
  let dueAt = nullInt(row.due_at);
  if (b.dueAt !== undefined) dueAt = parseDueAt(b.dueAt, false);
  let doneAt = nullInt(row.done_at);
  if (b.done === true) doneAt = t;
  if (b.done === false) doneAt = null;
  await e.DB.prepare(
    'UPDATE ops_followups SET body = ?, due_at = ?, done_at = ?, updated_at = ? WHERE id = ?',
  ).bind(bodyText, dueAt, doneAt, t, followupId).run();
  await auditWrite(e, actor.email, 'followup.update', 'followup', followupId, `updated ${followupId}`);
  const dto = followupDto(await loadFollowup(e, followupId));
  check(e, () => { assertFollowup(dto); });
  return jsonNoStore(dto);
}

export async function getFollowups(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const rawDue = url.searchParams.get('due');
  const due = (rawDue == null || rawDue === '' ? 'open' : rawDue) as DueFilter;
  if (!(DUE_FILTERS as readonly string[]).includes(due)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid due');
  }
  const t = now();
  const dayStart = shanghaiDayStart(shanghaiDateString(t));
  const nextMidnight = dayStart + DAY;
  let rows: Row[] = [];
  try {
    if (due === 'today') {
      rows = (await e.DB.prepare(
        `SELECT * FROM ops_followups
         WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at >= ? AND due_at < ?
         ORDER BY due_at ASC, id ASC LIMIT ?`,
      ).bind(dayStart, nextMidnight, FOLLOWUP_CAP).all<Row>()).results ?? [];
    } else if (due === 'overdue') {
      rows = (await e.DB.prepare(
        `SELECT * FROM ops_followups
         WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at < ?
         ORDER BY due_at ASC, id ASC LIMIT ?`,
      ).bind(dayStart, FOLLOWUP_CAP).all<Row>()).results ?? [];
    } else {
      rows = (await e.DB.prepare(
        `SELECT * FROM ops_followups
         WHERE done_at IS NULL
         ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, id ASC
         LIMIT ?`,
      ).bind(FOLLOWUP_CAP).all<Row>()).results ?? [];
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(followupDto);
  const updatedAt = items.reduce((max, row) => Math.max(max, row.updatedAt), t);
  return listJson(
    e, req, items, null, updatedAt,
    weakEtag([due, updatedAt, items.length]),
    assertFollowup, items.length,
  );
}

function emptyDigest(day: string, updatedAt: number): DigestDto {
  return {
    day,
    overnight: { resolved: [], opened: [] },
    open: [],
    due: { followups: [], checks: [] },
    worthwhile: emptyWorthwhile(updatedAt),
    updatedAt,
  };
}

export async function getDigest(req: Request, e: Env): Promise<Response> {
  const t = now();
  const url = new URL(req.url);
  const rawDay = url.searchParams.get('day');
  const day = rawDay == null || rawDay === '' ? shanghaiDateString(t) : rawDay;
  const dayStart = shanghaiDayStart(day);
  const nextMidnight = dayStart + DAY;
  const overnightFrom = dayStart - 6 * 3600;
  const overnightTo = t;
  let digest = emptyDigest(day, t);
  try {
    // Five statements (budget ≤6): overnight resolved, overnight opened,
    // currently open, follow-ups due by end of day, next-check due by end of day.
    const resolved = (await e.DB.prepare(
      `SELECT * FROM ops_incidents
       WHERE status = 'resolved' AND resolved_at >= ? AND resolved_at <= ?
         AND (closure IS NULL OR closure <> 'false_positive')
       ORDER BY resolved_at ASC, id ASC LIMIT ?`,
    ).bind(overnightFrom, overnightTo, DIGEST_CAP).all<Row>()).results ?? [];
    const opened = (await e.DB.prepare(
      `SELECT * FROM ops_incidents
       WHERE opened_at >= ? AND opened_at <= ?
       ORDER BY opened_at ASC, id ASC LIMIT ?`,
    ).bind(overnightFrom, overnightTo, DIGEST_CAP).all<Row>()).results ?? [];
    const open = (await e.DB.prepare(
      `SELECT * FROM ops_incidents
       WHERE status <> 'resolved'
       ORDER BY last_seen_at DESC, id DESC LIMIT ?`,
    ).bind(DIGEST_CAP).all<Row>()).results ?? [];
    const followups = (await e.DB.prepare(
      `SELECT * FROM ops_followups
       WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at < ?
       ORDER BY due_at ASC, id ASC LIMIT ?`,
    ).bind(nextMidnight, DIGEST_CAP).all<Row>()).results ?? [];
    const checks = (await e.DB.prepare(
      `SELECT * FROM ops_incidents
       WHERE status <> 'resolved' AND next_check_at IS NOT NULL AND next_check_at < ?
       ORDER BY next_check_at ASC, id ASC LIMIT ?`,
    ).bind(nextMidnight, DIGEST_CAP).all<Row>()).results ?? [];
    digest = {
      day,
      overnight: { resolved: resolved.map(incidentDto), opened: opened.map(incidentDto) },
      open: open.map(incidentDto),
      due: { followups: followups.map(followupDto), checks: checks.map(incidentDto) },
      worthwhile: digest.worthwhile,
      updatedAt: t,
    };
  } catch (error) {
    if (!missingTable(error) && !String(error).includes('no such column')) throw error;
  }
  try {
    digest = { ...digest, worthwhile: await weeklyPicks(e.DB, t) };
  } catch {
    delete digest.worthwhile;
  }

  const etag = weakEtag([day, digest.updatedAt, digest.open.length, digest.due.followups.length]);
  return entityJson(e, req, digest, etag, assertDigest);
}

export async function retainFollowups(db: D1Database, nowSec: number, limit = 500): Promise<void> {
  try {
    await db.prepare(
      `DELETE FROM ops_followups WHERE rowid IN (
         SELECT rowid FROM ops_followups
         WHERE done_at IS NOT NULL AND done_at <= ?
         ORDER BY done_at ASC LIMIT ?
       )`,
    ).bind(nowSec - 400 * DAY, limit).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}
