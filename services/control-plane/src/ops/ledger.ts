import { ApiError } from '../errors';
import type { Row } from '../env';
import {
  LEDGER_CATEGORIES,
  type LedgerCategory,
  type LedgerEntryDto,
  type LedgerKind,
  type LedgerSubjectType,
  type MonthByCategory,
  type MonthCustomerDto,
  type MonthNodeDto,
  type MonthSummaryDto,
} from './contract';
import { monthBounds } from './fx';
import { reconcileMonth } from './ledger-recon';

const ACCOUNT_CATEGORIES = new Set<LedgerCategory>(['claude_account', 'chatgpt_account']);

export function ledgerDto(row: Row): LedgerEntryDto {
  return {
    id: String(row.id),
    kind: String(row.kind) as LedgerKind,
    category: String(row.category) as LedgerCategory,
    subjectType: String(row.subject_type) as LedgerSubjectType,
    subjectId: row.subject_id == null || row.subject_id === '' ? null : String(row.subject_id),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    fxRateToCny: row.fx_rate_to_cny == null ? null : Number(row.fx_rate_to_cny),
    fxDate: row.fx_date == null ? null : String(row.fx_date),
    cnyMinor: Number(row.cny_minor),
    month: String(row.month),
    paidAt: row.paid_at == null ? null : Number(row.paid_at),
    note: row.note == null ? null : String(row.note),
    reverses: row.reverses == null ? null : String(row.reverses),
    reversedBy: row.reversed_by == null ? null : String(row.reversed_by),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: Number(row.created_at),
  };
}

export function emptyByCategory(): MonthByCategory {
  const out = {} as MonthByCategory;
  for (const key of LEDGER_CATEGORIES) out[key] = 0;
  return out;
}

function signedCny(kind: string, cnyMinor: number): number {
  return kind === 'refund' ? -cnyMinor : cnyMinor;
}

function addRevenue(kind: string, cnyMinor: number): number {
  if (kind === 'revenue' || kind === 'credit') return cnyMinor;
  if (kind === 'refund') return -cnyMinor;
  return 0;
}

async function monthClosed(db: D1Database, month: string): Promise<Row | null> {
  return db.prepare('SELECT * FROM ops_month_close WHERE month = ?').bind(month).first<Row>();
}

export async function requireOpenMonth(db: D1Database, month: string): Promise<void> {
  const closed = await monthClosed(db, month);
  if (closed) throw new ApiError(409, 'MONTH_CLOSED', `Month ${month} is closed`);
}

export async function loadClosedMonth(db: D1Database, month: string): Promise<Row | null> {
  return monthClosed(db, month);
}

/**
 * The two halves of a month that are not totals: who was allocated what, and
 * what each machine cost per GB. Stored on `ops_month_close.summary_json` at
 * close because the rows behind them keep moving afterwards.
 */
type MonthSnapshot = { customers: MonthCustomerDto[]; nodes: MonthNodeDto[]; partial: boolean };

/** Matches the column's CHECK. A month too big to store keeps its totals only. */
const SNAPSHOT_MAX_BYTES = 65_536;
const PARTIAL_SNAPSHOT = JSON.stringify({ customers: [], nodes: [], partial: true });

export function encodeMonthSnapshot(summary: MonthSummaryDto): string {
  const json = JSON.stringify({ customers: summary.customers, nodes: summary.nodes });
  return new TextEncoder().encode(json).length > SNAPSHOT_MAX_BYTES ? PARTIAL_SNAPSHOT : json;
}

function decodeMonthSnapshot(raw: unknown): MonthSnapshot | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const row = parsed as { customers?: unknown; nodes?: unknown; partial?: unknown };
  if (row.partial === true) return { customers: [], nodes: [], partial: true };
  if (!Array.isArray(row.customers) || !Array.isArray(row.nodes)) return null;
  return { customers: row.customers as MonthCustomerDto[], nodes: row.nodes as MonthNodeDto[], partial: false };
}

type BytesRow = { user_id: string; node: string; bytes: number };
type AccountRow = { id: string; user_id: string | null };
type UserRow = { id: string; email: string };
type CycleRow = { node_name: string };

export async function loadMonthSummary(db: D1Database, month: string, nowSec: number): Promise<MonthSummaryDto> {
  const { start, end } = monthBounds(month);
  const entries = (await db.prepare(
    'SELECT * FROM ops_ledger_entries WHERE month = ?',
  ).bind(month).all<Row>()).results ?? [];
  const closed = await db.prepare(
    'SELECT * FROM ops_month_close WHERE month = ?',
  ).bind(month).first<Row>();
  const activity = (await db.prepare(
    `SELECT user_id, node, SUM(bytes_up + bytes_down) AS bytes
     FROM customer_activity_hours
     WHERE hour_at >= ? AND hour_at < ? AND node IS NOT NULL AND node != ''
     GROUP BY user_id, node`,
  ).bind(start, end).all<BytesRow>()).results ?? [];
  const accounts = (await db.prepare(
    'SELECT id, user_id FROM product_accounts',
  ).all<AccountRow>()).results ?? [];
  const users = (await db.prepare(
    'SELECT id, email FROM users',
  ).all<UserRow>()).results ?? [];
  const cycles = (await db.prepare(
    `SELECT DISTINCT node_name FROM node_traffic_cycles
     WHERE cycle_start < ? AND cycle_end > ?`,
  ).bind(end, start).all<CycleRow>()).results ?? [];
  // 6 statements. Covering cycle = metering present (open/closed both count).

  const byCategory = emptyByCategory();
  let revenueCnyMinor = 0;
  let costCnyMinor = 0;
  let updatedAt = nowSec;
  const userRevenue = new Map<string, number>();
  const userCost = new Map<string, number>();
  const serverCost = new Map<string, number>();
  const lineCost = new Map<string, number>();
  const accountCost = new Map<string, number>();
  const serverCostPresent = new Set<string>();

  for (const raw of entries) {
    const entry = ledgerDto(raw);
    updatedAt = Math.max(updatedAt, Number(raw.updated_at ?? entry.createdAt));
    const category = entry.category;
    byCategory[category] = (byCategory[category] ?? 0) + signedCny(entry.kind, entry.cnyMinor);
    revenueCnyMinor += addRevenue(entry.kind, entry.cnyMinor);
    if (entry.kind === 'cost') costCnyMinor += entry.cnyMinor;
    if (entry.subjectType === 'user' && entry.subjectId) {
      userRevenue.set(entry.subjectId, (userRevenue.get(entry.subjectId) ?? 0) + addRevenue(entry.kind, entry.cnyMinor));
    }
    if (entry.kind === 'cost' && entry.category === 'server' && entry.subjectType === 'node' && entry.subjectId) {
      serverCost.set(entry.subjectId, (serverCost.get(entry.subjectId) ?? 0) + entry.cnyMinor);
      serverCostPresent.add(entry.subjectId);
    }
    if (entry.kind === 'cost' && entry.category === 'home_line' && entry.subjectId) {
      lineCost.set(entry.subjectId, (lineCost.get(entry.subjectId) ?? 0) + entry.cnyMinor);
    }
    if (entry.kind === 'cost' && ACCOUNT_CATEGORIES.has(entry.category) && entry.subjectId) {
      accountCost.set(entry.subjectId, (accountCost.get(entry.subjectId) ?? 0) + entry.cnyMinor);
    }
  }

  const emailByUser = new Map<string, string>();
  for (const user of users) emailByUser.set(String(user.id), String(user.email ?? ''));
  const ownerByAccount = new Map<string, string>();
  for (const account of accounts) {
    if (account.user_id) ownerByAccount.set(String(account.id), String(account.user_id));
  }
  for (const [accountId, cny] of accountCost) {
    const owner = ownerByAccount.get(accountId);
    if (!owner) continue;
    userCost.set(owner, (userCost.get(owner) ?? 0) + cny);
  }

  const nodeBytes = new Map<string, number>();
  const userNodeBytes = new Map<string, Map<string, number>>();
  for (const row of activity) {
    const userId = String(row.user_id);
    const node = String(row.node);
    const bytes = Number(row.bytes ?? 0);
    nodeBytes.set(node, (nodeBytes.get(node) ?? 0) + bytes);
    let perNode = userNodeBytes.get(userId);
    if (!perNode) {
      perNode = new Map();
      userNodeBytes.set(userId, perNode);
    }
    perNode.set(node, (perNode.get(node) ?? 0) + bytes);
  }

  const allocate = (costBySubject: Map<string, number>) => {
    for (const [subject, cost] of costBySubject) {
      const total = nodeBytes.get(subject) ?? 0;
      if (total <= 0 || cost === 0) continue;
      for (const [userId, perNode] of userNodeBytes) {
        const share = perNode.get(subject) ?? 0;
        if (share <= 0) continue;
        userCost.set(userId, (userCost.get(userId) ?? 0) + Math.round(cost * (share / total)));
      }
    }
  };
  allocate(serverCost);
  allocate(lineCost);

  const covering = new Set(cycles.map((row) => String(row.node_name)));
  const userIds = new Set<string>([
    ...userRevenue.keys(), ...userCost.keys(), ...userNodeBytes.keys(),
  ]);
  const customers: MonthCustomerDto[] = [];
  for (const userId of userIds) {
    const revenue = userRevenue.get(userId) ?? 0;
    const cost = userCost.get(userId) ?? 0;
    const used = userNodeBytes.get(userId);
    let pending = false;
    if (used) {
      for (const [node, bytes] of used) {
        if (bytes <= 0) continue;
        if (!covering.has(node) || !serverCostPresent.has(node)) {
          pending = true;
          break;
        }
      }
    }
    customers.push({
      userId,
      email: emailByUser.get(userId) ?? '',
      revenueCnyMinor: revenue,
      costCnyMinor: cost,
      marginCnyMinor: pending ? null : revenue - cost,
      pending,
    });
  }
  customers.sort((a, b) => a.email.localeCompare(b.email) || a.userId.localeCompare(b.userId));

  const nodeNames = new Set<string>([...serverCost.keys(), ...nodeBytes.keys()]);
  const nodes: MonthNodeDto[] = [];
  for (const name of nodeNames) {
    const cost = serverCost.get(name) ?? 0;
    const bytes = nodeBytes.get(name) ?? 0;
    const meteringOk = covering.has(name);
    const pending = bytes === 0 || !meteringOk;
    const cnyPerGbMinor = pending ? null : Math.round(cost / (bytes / 1e9));
    nodes.push({ name, costCnyMinor: cost, bytes, cnyPerGbMinor, pending });
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name));

  const unreconciled = customers.filter((row) => row.pending).length + nodes.filter((row) => row.pending).length;
  if (closed) updatedAt = Math.max(updatedAt, Number(closed.closed_at ?? 0));
  const reconciliation = await reconcileMonth(db, month, nowSec, { entries, closed });

  // A closed month answers with the halves it was closed with. A month closed
  // before the snapshot column existed — or one whose snapshot did not fit —
  // has none, so it answers live and says so rather than pretending.
  const snapshot = closed ? decodeMonthSnapshot(closed.summary_json) : null;
  const frozenPartial = Boolean(closed) && (snapshot === null || snapshot.partial);

  return {
    month,
    closedAt: closed ? Number(closed.closed_at) : null,
    closedBy: closed?.closed_by == null ? null : String(closed.closed_by),
    revenueCnyMinor: closed ? Number(closed.revenue_cny_minor) : revenueCnyMinor,
    costCnyMinor: closed ? Number(closed.cost_cny_minor) : costCnyMinor,
    marginCnyMinor: closed ? Number(closed.margin_cny_minor) : revenueCnyMinor - costCnyMinor,
    byCategory,
    customers: snapshot && !snapshot.partial ? snapshot.customers : customers,
    nodes: snapshot && !snapshot.partial ? snapshot.nodes : nodes,
    unreconciled: closed ? Number(closed.unreconciled) : unreconciled,
    frozen: Boolean(closed),
    frozenAt: closed ? Number(closed.closed_at) : null,
    ...(frozenPartial ? { frozenPartial: true } : {}),
    reconciliation,
    unreconciledBills: reconciliation.billsWithoutLedger.length + reconciliation.ledgerWithoutBill.length,
    updatedAt,
  };
}

const CSV_HEADERS = [
  'id', 'kind', 'category', 'subjectType', 'subjectId', 'amountMinor', 'currency',
  'fxRateToCny', 'fxDate', 'cnyMinor', 'month', 'paidAt', 'note',
  'reverses', 'reversedBy', 'createdBy', 'createdAt',
] as const;

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Formula guard on text that a spreadsheet would execute. A number is a
  // number: `-80000` is arithmetic, and quoting it into `'-80000` turned every
  // negative amount in the export into a string nobody could sum. Prefix only
  // `= + @` / tab / CR, or `-` followed by a non-digit.
  if (/^[=+@\t\r]/.test(text) || /^-($|[^0-9])/.test(text)) {
    return `"${`'${text}`.replace(/"/g, '""')}"`;
  }
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Money in counts up, money out counts down — in whatever unit it is asked in. */
function signedTotal(kind: string, minor: number): number {
  if (kind === 'revenue' || kind === 'credit') return minor;
  if (kind === 'refund' || kind === 'cost') return -minor;
  return 0;
}

export function ledgerCsv(entries: LedgerEntryDto[]): string {
  const lines = [CSV_HEADERS.join(',')];
  let amount = 0;
  let cny = 0;
  const currencies = new Set<string>();
  for (const entry of entries) {
    amount += signedTotal(entry.kind, entry.amountMinor);
    cny += signedTotal(entry.kind, entry.cnyMinor);
    currencies.add(entry.currency);
    lines.push([
      entry.id, entry.kind, entry.category, entry.subjectType, entry.subjectId,
      entry.amountMinor, entry.currency, entry.fxRateToCny, entry.fxDate, entry.cnyMinor,
      entry.month, entry.paidAt, entry.note, entry.reverses, entry.reversedBy,
      entry.createdBy, entry.createdAt,
    ].map(csvCell).join(','));
  }
  const total = [
    '', 'total', '', '', '', currencies.size === 1 ? amount : '', '', '', '', cny, '', '', '', '', '', '', '',
  ].map(csvCell).join(',');
  lines.push(total);
  return `\uFEFF${lines.join('\r\n')}`;
}
