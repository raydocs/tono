import { type Row, id, now } from '../env';
import type { ChangeReceiptDto, ChangeReceiptKind } from './contract';

const JSON_MAX = 4096;

function missingTable(error: unknown): boolean {
  return String(error).includes('no such table');
}

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= JSON_MAX) return text;
    // If it exceeds JSON_MAX, try to store a trimmed summary
    if (typeof value === 'object') {
      const shallow = { ...value as Record<string, unknown> };
      if ('listed' in shallow && Array.isArray(shallow.listed)) {
        shallow.listed = (shallow.listed as unknown[]).slice(0, 5);
        const retry = JSON.stringify(shallow);
        if (retry.length <= JSON_MAX) return retry;
      }
    }
    return text.slice(0, JSON_MAX);
  } catch {
    return null;
  }
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface WriteReceiptInput {
  kind: ChangeReceiptKind;
  subjectType: string;
  subjectId: string;
  incidentId?: string | null;
  jobId?: string | null;
  before?: unknown;
  after?: unknown;
  clientAcks?: number;
  rollbackOf?: string | null;
  actor?: string | null;
  at?: number;
}

export function receiptDto(row: Row): ChangeReceiptDto {
  return {
    id: String(row.id),
    kind: String(row.kind) as ChangeReceiptKind,
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    incidentId: row.incident_id == null ? null : String(row.incident_id),
    jobId: row.job_id == null ? null : String(row.job_id),
    before: parseJson(row.before_json),
    after: parseJson(row.after_json),
    clientAcks: Number(row.client_acks) || 0,
    rollbackOf: row.rollback_of == null ? null : String(row.rollback_of),
    actor: row.actor == null ? null : String(row.actor),
    at: Number(row.at),
  };
}

export async function writeChangeReceipt(
  db: D1Database,
  input: WriteReceiptInput,
): Promise<ChangeReceiptDto> {
  const receiptId = id();
  const at = input.at ?? now();
  const beforeJson = safeJson(input.before);
  const afterJson = safeJson(input.after);

  await db.prepare(
    `INSERT INTO ops_change_receipts (
       id, kind, subject_type, subject_id, incident_id, job_id,
       before_json, after_json, client_acks, rollback_of, actor, at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    receiptId,
    input.kind,
    input.subjectType,
    input.subjectId,
    input.incidentId ?? null,
    input.jobId ?? null,
    beforeJson,
    afterJson,
    input.clientAcks ?? 0,
    input.rollbackOf ?? null,
    input.actor ?? null,
    at,
  ).run();

  return {
    id: receiptId,
    kind: input.kind,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    incidentId: input.incidentId ?? null,
    jobId: input.jobId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    clientAcks: input.clientAcks ?? 0,
    rollbackOf: input.rollbackOf ?? null,
    actor: input.actor ?? null,
    at,
  };
}

export async function loadReceiptsForIncident(
  db: D1Database,
  incidentId: string,
  limit = 50,
): Promise<ChangeReceiptDto[]> {
  try {
    const rows = (await db.prepare(
      `SELECT * FROM ops_change_receipts
       WHERE incident_id = ?
       ORDER BY at DESC, id DESC
       LIMIT ?`,
    ).bind(incidentId, limit).all<Row>()).results ?? [];
    return rows.map(receiptDto);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function loadReceiptsForSubject(
  db: D1Database,
  subjectType: string,
  subjectId: string,
  limit = 50,
): Promise<ChangeReceiptDto[]> {
  try {
    const rows = (await db.prepare(
      `SELECT * FROM ops_change_receipts
       WHERE subject_type = ? AND subject_id = ?
       ORDER BY at DESC, id DESC
       LIMIT ?`,
    ).bind(subjectType, subjectId, limit).all<Row>()).results ?? [];
    return rows.map(receiptDto);
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function updateChangeReceiptClientAcks(db: D1Database): Promise<void> {
  try {
    const row = await db.prepare(
      `SELECT id, after_json FROM ops_change_receipts
       WHERE kind IN ('catalog_retire', 'catalog_relist', 'catalog_publish')
       ORDER BY at DESC, id DESC
       LIMIT 1`,
    ).first<{ id: string; after_json: string | null }>();
    if (!row || !row.after_json) return;
    let after: { revision?: unknown };
    try {
      after = JSON.parse(row.after_json) as { revision?: unknown };
    } catch {
      return;
    }
    const revision = typeof after?.revision === 'number' ? after.revision : null;
    if (revision === null) return;
    const countRow = await db.prepare(
      `SELECT COUNT(DISTINCT user_id) AS count FROM connection_events WHERE catalog_revision >= ?`,
    ).bind(revision).first<{ count: number }>();
    const count = Number(countRow?.count ?? 0);
    await db.prepare(
      `UPDATE ops_change_receipts SET client_acks = ? WHERE id = ?`,
    ).bind(count, row.id).run();
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
}
