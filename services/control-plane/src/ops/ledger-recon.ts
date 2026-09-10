// Month-end pairing: bills that should exist vs cost rows that were written.
//
// Closed months prefer the `summary_json` snapshot written at lock (D1 / 1.3).
// Open months, and closed months without a snapshot, are computed live.

import type { Row } from '../env';
import {
  assertMonthReconciliation,
  type LedgerCategory,
  type MonthReconRowDto,
  type MonthReconciliationDto,
  type ReconReason,
  type ReconSubjectType,
} from './contract';

type Asset = {
  subjectType: ReconSubjectType;
  subjectId: string;
  label: string;
  category: LedgerCategory;
  ownerUserId: string | null;
  expectedMinor: number | null;
  expectedCurrency: string | null;
  /** In the expected-bill set: active, and priced (accounts: assigned). */
  billable: boolean;
  retired: boolean;
};

type CostGroup = {
  net: number;
  ids: string[];
  category: LedgerCategory;
};

const ZERO_DECIMALS = new Set(['JPY', 'KRW']);

function keyOf(type: string, id: string): string {
  return `${type}\0${id}`;
}

function decimalsOf(currency: string | null): number {
  return ZERO_DECIMALS.has((currency ?? '').toUpperCase()) ? 0 : 2;
}

function priceToMinor(price: number, currency: string | null): number {
  return Math.round(price * 10 ** decimalsOf(currency));
}

function currencyOf(value: unknown): string | null {
  if (value == null || value === '') return null;
  const text = String(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : String(value);
}

function moneyOf(price: unknown, currency: string | null): { minor: number | null; currency: string | null } {
  if (price == null || price === '') return { minor: null, currency };
  const n = Number(price);
  if (!Number.isFinite(n)) return { minor: null, currency };
  return { minor: priceToMinor(n, currency), currency };
}

function accountCategory(product: string, accountRef: string): LedgerCategory {
  const hay = `${product} ${accountRef}`.toLowerCase();
  const ref = accountRef.toLowerCase();
  if (hay.includes('chatgpt') || hay.includes('openai') || ref.startsWith('gpt')) {
    return 'chatgpt_account';
  }
  return 'claude_account';
}

function sortRows(rows: MonthReconRowDto[]): MonthReconRowDto[] {
  return rows.sort((a, b) => a.subjectType.localeCompare(b.subjectType) || a.subjectId.localeCompare(b.subjectId));
}

function rowOf(asset: Asset, over: {
  ledgerCnyMinor: number | null;
  entryIds: string[];
  reason: ReconReason;
}): MonthReconRowDto {
  return {
    subjectType: asset.subjectType,
    subjectId: asset.subjectId,
    label: asset.label,
    category: asset.category,
    ownerUserId: asset.ownerUserId,
    expectedMinor: asset.expectedMinor,
    expectedCurrency: asset.expectedCurrency,
    ledgerCnyMinor: over.ledgerCnyMinor,
    entryIds: over.entryIds,
    reason: over.reason,
  };
}

function unknownAsset(type: ReconSubjectType, id: string, category: LedgerCategory): Asset {
  return {
    subjectType: type,
    subjectId: id,
    label: id,
    category,
    ownerUserId: null,
    expectedMinor: null,
    expectedCurrency: null,
    billable: false,
    retired: false,
  };
}

function reconFromSnapshot(closed: Row | null | undefined): MonthReconciliationDto | null {
  if (!closed) return null;
  const raw = closed.summary_json;
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(String(raw)) as { reconciliation?: unknown };
    if (parsed.reconciliation == null) return null;
    return assertMonthReconciliation(parsed.reconciliation);
  } catch {
    return null;
  }
}

function groupCosts(entries: Row[]): Map<string, CostGroup> {
  const groups = new Map<string, CostGroup>();
  for (const raw of entries) {
    if (String(raw.kind) !== 'cost') continue;
    const subjectType = String(raw.subject_type);
    if (subjectType !== 'node' && subjectType !== 'home_exit' && subjectType !== 'account') continue;
    if (raw.subject_id == null || raw.subject_id === '') continue;
    const subjectId = String(raw.subject_id);
    const category = String(raw.category) as LedgerCategory;
    const id = String(raw.id);
    const cny = Number(raw.cny_minor);
    const key = keyOf(subjectType, subjectId);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { net: cny, ids: [id], category });
      continue;
    }
    group.net += cny;
    group.ids.push(id);
  }
  return groups;
}

async function loadAssets(db: D1Database): Promise<Map<string, Asset>> {
  const assets = new Map<string, Asset>();

  const nodes = (await db.prepare(
    'SELECT catalog_name, price, currency, status FROM ops_node_profiles',
  ).all<Row>()).results ?? [];
  for (const row of nodes) {
    const subjectId = String(row.catalog_name);
    const currency = currencyOf(row.currency);
    const money = moneyOf(row.price, currency);
    const retired = String(row.status) === 'retired';
    const billable = !retired && money.minor != null;
    assets.set(keyOf('node', subjectId), {
      subjectType: 'node',
      subjectId,
      label: subjectId,
      category: 'server',
      ownerUserId: null,
      expectedMinor: money.minor,
      expectedCurrency: money.currency,
      billable,
      retired,
    });
  }

  const lines = (await db.prepare(
    `SELECT id, display_name, price, currency, billing_kind, status FROM home_exits`,
  ).all<Row>()).results ?? [];
  for (const row of lines) {
    const subjectId = String(row.id);
    const currency = currencyOf(row.currency);
    const money = moneyOf(row.price, currency);
    const status = String(row.status);
    const retired = status === 'retired' || status === 'disabled';
    const monthly = String(row.billing_kind ?? '') === 'monthly';
    const billable = !retired && monthly && money.minor != null;
    assets.set(keyOf('home_exit', subjectId), {
      subjectType: 'home_exit',
      subjectId,
      label: String(row.display_name ?? subjectId),
      category: 'home_line',
      ownerUserId: null,
      expectedMinor: money.minor,
      expectedCurrency: money.currency,
      billable,
      retired,
    });
  }

  const accounts = (await db.prepare(
    'SELECT id, user_id, product, account_ref, status FROM product_accounts',
  ).all<Row>()).results ?? [];
  for (const row of accounts) {
    const subjectId = String(row.id);
    const status = String(row.status);
    const assigned = status === 'assigned';
    assets.set(keyOf('account', subjectId), {
      subjectType: 'account',
      subjectId,
      label: String(row.account_ref ?? subjectId),
      category: accountCategory(String(row.product ?? ''), String(row.account_ref ?? '')),
      ownerUserId: row.user_id == null || row.user_id === '' ? null : String(row.user_id),
      expectedMinor: null,
      expectedCurrency: null,
      billable: assigned,
      retired: !assigned,
    });
  }

  return assets;
}

function ledgerReason(asset: Asset | undefined): ReconReason {
  if (!asset) return 'unknown_subject';
  if (asset.retired) return 'retired_subject';
  return 'no_price';
}

function billReason(asset: Asset): ReconReason {
  return asset.expectedMinor == null ? 'no_price' : 'no_ledger';
}

async function computeRecon(
  db: D1Database,
  month: string,
  nowSec: number,
  entries: Row[] | undefined,
): Promise<MonthReconciliationDto> {
  const rows = entries ?? (await db.prepare(
    'SELECT * FROM ops_ledger_entries WHERE month = ?',
  ).bind(month).all<Row>()).results ?? [];
  const assets = await loadAssets(db);
  const groups = groupCosts(rows);

  const billsWithoutLedger: MonthReconRowDto[] = [];
  const ledgerWithoutBill: MonthReconRowDto[] = [];

  for (const asset of assets.values()) {
    if (!asset.billable) continue;
    const group = groups.get(keyOf(asset.subjectType, asset.subjectId));
    if (group && group.net !== 0) continue;
    billsWithoutLedger.push(rowOf(asset, {
      ledgerCnyMinor: null,
      entryIds: [],
      reason: billReason(asset),
    }));
  }

  for (const [key, group] of groups) {
    if (group.net === 0) continue;
    const sep = key.indexOf('\0');
    const subjectType = key.slice(0, sep) as ReconSubjectType;
    const subjectId = key.slice(sep + 1);
    const asset = assets.get(key);
    if (asset?.billable) continue;
    const subject = asset ?? unknownAsset(subjectType, subjectId, group.category);
    ledgerWithoutBill.push(rowOf(subject, {
      ledgerCnyMinor: group.net,
      entryIds: [...group.ids].sort(),
      reason: ledgerReason(asset),
    }));
  }

  return {
    billsWithoutLedger: sortRows(billsWithoutLedger),
    ledgerWithoutBill: sortRows(ledgerWithoutBill),
    asOfSec: nowSec,
  };
}

export async function reconcileMonth(
  db: D1Database,
  month: string,
  nowSec: number,
  options: { entries?: Row[]; closed?: Row | null } = {},
): Promise<MonthReconciliationDto> {
  const frozen = reconFromSnapshot(options.closed);
  if (frozen) return frozen;
  return computeRecon(db, month, nowSec, options.entries);
}
