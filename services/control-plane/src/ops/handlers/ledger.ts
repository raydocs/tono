import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import {
  LEDGER_CATEGORIES,
  LEDGER_KINDS,
  LEDGER_SUBJECT_TYPES,
  assertFxRate,
  assertLedgerEntry,
  assertMonthSummary,
} from '../contract';
import {
  cnyIdentityRate,
  cnyMinorFrom,
  fxDto,
  lookupRate,
  parseBase,
  parseDay,
  parseMonth,
  utcDateString,
  utcMonthString,
} from '../fx';
import { encodeMonthSnapshot, ledgerCsv, ledgerDto, loadMonthSummary, requireOpenMonth } from '../ledger';
import {
  Actor,
  Env,
  Row,
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

function uniqueConflict(error: unknown): boolean {
  return String(error).includes('UNIQUE constraint failed');
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const text = String(value ?? '');
  if (!(allowed as readonly string[]).includes(text)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  }
  return text as T;
}

function parseAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1e12) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid amountMinor');
  }
  return value;
}

function parseCurrency(value: unknown): string {
  const text = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid currency');
  return text;
}

const REVENUE_KINDS: ReadonlySet<string> = new Set(['revenue', 'refund', 'credit']);

function currencyForKind(kind: string, value: unknown): string {
  const omitted = value === undefined || value === null || value === '';
  if (omitted) return kind === 'cost' ? 'USD' : 'CNY';
  const currency = parseCurrency(value);
  if (REVENUE_KINDS.has(kind) && currency !== 'CNY') {
    throw new ApiError(400, 'VALIDATION_ERROR', '收款只收人民币');
  }
  return currency;
}

function parseNote(value: unknown, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid note');
    return null;
  }
  if (typeof value !== 'string' || value.length > 500) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid note');
  }
  return value;
}

function parsePaidAt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid paidAt');
  }
  return value;
}

function parseSubjectId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (text.length > 200 || /[\r\n\0]/.test(text)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid subjectId');
  }
  return text;
}

async function loadEntry(e: Env, entryId: string): Promise<Row> {
  const row = await e.DB.prepare('SELECT * FROM ops_ledger_entries WHERE id = ?').bind(entryId).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Ledger entry not found');
  return row;
}

async function rateFor(e: Env, currency: string, fxDate: string): Promise<{ rate: number; day: string }> {
  const stored = await lookupRate(e.DB, currency, fxDate);
  if (!stored) throw new ApiError(409, 'FX_RATE_MISSING', `No FX rate for ${currency} on ${fxDate}`);
  return { rate: stored.rate, day: stored.day };
}

export async function getLedger(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const t = now();
  const month = parseMonth(url.searchParams.get('month'), utcMonthString(t));
  const { cursor, limit } = pageParams(url);
  let rows: Row[] = [];
  let total = 0;
  try {
    const count = await e.DB.prepare(
      'SELECT COUNT(*) AS c FROM ops_ledger_entries WHERE month = ?',
    ).bind(month).first<{ c: number }>();
    total = Number(count?.c ?? 0);
    const binds: (string | number)[] = [month];
    let sql = 'SELECT * FROM ops_ledger_entries WHERE month = ?';
    if (cursor) {
      sql += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
      const sortAt = Number(cursor.sortKey);
      binds.push(sortAt, sortAt, cursor.id);
    }
    sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
    binds.push(limit + 1);
    rows = (await e.DB.prepare(sql).bind(...binds).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(ledgerDto);
  const page = items.slice(0, limit + 1);
  const sliced = page.length > limit ? page.slice(0, limit) : page;
  const last = sliced[sliced.length - 1];
  const nextCursor = page.length > limit && last ? encodeCursor(String(last.createdAt), last.id) : null;
  const updatedAt = sliced[0]?.createdAt ?? t;
  return listJson(
    e, req, sliced, nextCursor, updatedAt,
    weakEtag([month, updatedAt, total]),
    assertLedgerEntry, total,
  );
}

export async function postLedger(req: Request, e: Env, actor: Actor): Promise<Response> {
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'kind', 'category', 'subjectType', 'subjectId', 'amountMinor', 'currency',
    'month', 'paidAt', 'note', 'fxDate',
  ]);
  const t = now();
  const month = parseMonth(String(b.month ?? ''), undefined);
  await requireOpenMonth(e.DB, month);
  const kind = oneOf(b.kind, LEDGER_KINDS, 'kind');
  const category = oneOf(b.category, LEDGER_CATEGORIES, 'category');
  const subjectType = oneOf(b.subjectType, LEDGER_SUBJECT_TYPES, 'subjectType');
  const subjectId = parseSubjectId(b.subjectId);
  const amountMinor = parseAmount(b.amountMinor);
  const currency = currencyForKind(kind, b.currency);
  const fxDate = parseDay(b.fxDate as string | null | undefined, utcDateString(t));
  const { rate, day } = await rateFor(e, currency, fxDate);
  const cnyMinor = cnyMinorFrom(amountMinor, rate);
  const entryId = id();
  const paidAt = parsePaidAt(b.paidAt);
  const note = parseNote(b.note);
  const inserted = await e.DB.prepare(
    `INSERT INTO ops_ledger_entries(
       id, kind, category, subject_type, subject_id, amount_minor, currency,
       fx_rate_to_cny, fx_date, cny_minor, month, paid_at, note,
       reverses, reversed_by, created_by, created_at, updated_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM ops_month_close WHERE month = ?)`,
  ).bind(
    entryId, kind, category, subjectType, subjectId, amountMinor, currency,
    rate, day, cnyMinor, month, paidAt, note, actor.email, t, t, month,
  ).run();
  if (Number(inserted.meta.changes ?? 0) !== 1) {
    await requireOpenMonth(e.DB, month);
    throw new ApiError(409, 'MONTH_CLOSED', `Month ${month} is closed`);
  }
  await auditWrite(e, actor.email, 'ledger.create', 'ledger_entry', entryId, `${kind} ${currency} ${amountMinor}`);
  const dto = ledgerDto(await loadEntry(e, entryId));
  check(e, () => { assertLedgerEntry(dto); });
  return jsonNoStore(dto, 201);
}

export async function patchLedger(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const entryId = decodeName(rawId, 'id');
  const row = await loadEntry(e, entryId);
  await requireOpenMonth(e.DB, String(row.month));
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, ['note', 'paidAt', 'subjectType', 'subjectId']);
  if (b.note === undefined && b.paidAt === undefined && b.subjectType === undefined && b.subjectId === undefined) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Nothing to update');
  }
  const t = now();
  const note = b.note === undefined ? nullText(row.note) : parseNote(b.note);
  const paidAt = b.paidAt === undefined ? nullInt(row.paid_at) : parsePaidAt(b.paidAt);
  let subjectType = String(row.subject_type);
  let subjectId = nullText(row.subject_id);
  if (b.subjectType !== undefined) subjectType = oneOf(b.subjectType, LEDGER_SUBJECT_TYPES, 'subjectType');
  if (b.subjectId !== undefined) subjectId = parseSubjectId(b.subjectId);
  await e.DB.prepare(
    `UPDATE ops_ledger_entries
     SET note = ?, paid_at = ?, subject_type = ?, subject_id = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(note, paidAt, subjectType, subjectId, t, entryId).run();
  await auditWrite(e, actor.email, 'ledger.update', 'ledger_entry', entryId, `updated ${entryId}`);
  const dto = ledgerDto(await loadEntry(e, entryId));
  check(e, () => { assertLedgerEntry(dto); });
  return jsonNoStore(dto);
}

export async function postLedgerReverse(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const entryId = decodeName(rawId, 'id');
  const original = await loadEntry(e, entryId);
  if (nullText(original.reversed_by)) {
    throw new ApiError(409, 'ALREADY_REVERSED', 'Ledger entry is already reversed');
  }
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, ['note']);
  const t = now();
  const month = utcMonthString(t);
  await requireOpenMonth(e.DB, month);
  const reverseId = `reverse:${entryId}`;
  const note = parseNote(b.note) ?? `reverses ${entryId}`;
  try {
    const results = await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO ops_ledger_entries(
           id, kind, category, subject_type, subject_id, amount_minor, currency,
           fx_rate_to_cny, fx_date, cny_minor, month, paid_at, note,
           reverses, reversed_by, created_by, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?
         WHERE (SELECT reversed_by FROM ops_ledger_entries WHERE id = ?) IS NULL
           AND NOT EXISTS (SELECT 1 FROM ops_month_close WHERE month = ?)`,
      ).bind(
        reverseId, original.kind, original.category, original.subject_type, original.subject_id,
        original.amount_minor, original.currency, original.fx_rate_to_cny, original.fx_date,
        -Number(original.cny_minor), month, note, entryId, actor.email, t, t,
        entryId, month,
      ),
      e.DB.prepare(
        'UPDATE ops_ledger_entries SET reversed_by = ?, updated_at = ? WHERE id = ? AND reversed_by IS NULL',
      ).bind(reverseId, t, entryId),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      await requireOpenMonth(e.DB, month);
      throw new ApiError(409, 'ALREADY_REVERSED', 'Ledger entry is already reversed');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (uniqueConflict(error)) {
      throw new ApiError(409, 'ALREADY_REVERSED', 'Ledger entry is already reversed');
    }
    throw error;
  }
  await auditWrite(e, actor.email, 'ledger.reverse', 'ledger_entry', reverseId, `reverses ${entryId}`);
  const dto = ledgerDto(await loadEntry(e, reverseId));
  check(e, () => { assertLedgerEntry(dto); });
  return jsonNoStore(dto, 201);
}

export async function getMonth(req: Request, e: Env, rawMonth: string): Promise<Response> {
  const month = parseMonth(decodeName(rawMonth, 'month'));
  let dto;
  try {
    dto = await loadMonthSummary(e.DB, month, now());
  } catch (error) {
    if (!missingTable(error)) throw error;
    dto = await loadMonthSummaryFallback(month, now());
  }
  return entityJson(e, req, dto, weakEtag([month, dto.updatedAt, dto.unreconciled]), assertMonthSummary);
}

async function loadMonthSummaryFallback(month: string, nowSec: number) {
  return {
    month, closedAt: null, closedBy: null,
    revenueCnyMinor: 0, costCnyMinor: 0, marginCnyMinor: 0,
    byCategory: {
      plan: 0, server: 0, home_line: 0, domain: 0, control_plane: 0,
      claude_account: 0, chatgpt_account: 0, other: 0,
    },
    customers: [], nodes: [], unreconciled: 0, frozen: false, frozenAt: null,
    reconciliation: { billsWithoutLedger: [], ledgerWithoutBill: [], asOfSec: nowSec },
    unreconciledBills: 0,
    updatedAt: nowSec,
  };
}

export async function postMonthClose(req: Request, e: Env, rawMonth: string, actor: Actor): Promise<Response> {
  const month = parseMonth(decodeName(rawMonth, 'month'));
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, ['notes']);
  const notes = parseNote(b.notes);
  const existing = await e.DB.prepare('SELECT month FROM ops_month_close WHERE month = ?').bind(month).first<Row>();
  if (existing) throw new ApiError(409, 'MONTH_CLOSED', `Month ${month} is already closed`);
  const t = now();
  const summary = await loadMonthSummary(e.DB, month, t);
  // The four totals and, beside them, the two halves under them. A month whose
  // snapshot does not fit stores NULL and answers `frozenPartial` afterwards —
  // an oversized month is still a closed month.
  const inserted = await e.DB.prepare(
    `INSERT OR IGNORE INTO ops_month_close(
       month, closed_at, closed_by, revenue_cny_minor, cost_cny_minor,
       margin_cny_minor, unreconciled, notes, summary_json
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    month, t, actor.email, summary.revenueCnyMinor, summary.costCnyMinor,
    summary.marginCnyMinor, summary.unreconciled, notes, encodeMonthSnapshot(summary),
  ).run();
  if (Number(inserted.meta.changes ?? 0) !== 1) {
    throw new ApiError(409, 'MONTH_CLOSED', `Month ${month} is already closed`);
  }
  await auditWrite(e, actor.email, 'month.close', 'month', month, `closed ${month}`);
  const dto = await loadMonthSummary(e.DB, month, t);
  check(e, () => { assertMonthSummary(dto); });
  return jsonNoStore(dto);
}

export async function getMonthExport(req: Request, e: Env, rawMonth: string): Promise<Response> {
  void req;
  const month = parseMonth(decodeName(rawMonth, 'month'));
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT * FROM ops_ledger_entries WHERE month = ? ORDER BY created_at ASC, id ASC`,
    ).bind(month).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const csv = ledgerCsv(rows.map(ledgerDto));
  return new Response(new TextEncoder().encode(csv), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ledger-${month}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

export async function getFx(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const t = now();
  const day = parseDay(url.searchParams.get('day'), utcDateString(t));
  const base = parseBase(url.searchParams.get('base'));
  if (base === 'CNY') {
    const dto = fxDto(cnyIdentityRate(day, t));
    return entityJson(e, req, dto, weakEtag([day, base, 1]), assertFxRate);
  }
  let stored;
  try {
    stored = await lookupRate(e.DB, base, day);
  } catch (error) {
    if (!missingTable(error)) throw error;
    stored = null;
  }
  if (!stored) throw new ApiError(409, 'FX_RATE_MISSING', `No FX rate for ${base} on ${day}`);
  const dto = fxDto(stored);
  check(e, () => { assertFxRate(dto); });
  return entityJson(e, req, dto, weakEtag([dto.day, dto.base, dto.rate, dto.fetchedAt]), assertFxRate);
}
