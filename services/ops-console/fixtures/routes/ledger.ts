import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { nowSec } from '../../src/lib/clock';
import type {
  FxRateDto,
  LedgerCategory,
  LedgerEntryDto,
  LedgerKind,
  LedgerSubjectType,
  MonthSummaryDto,
} from '../../src/lib/api-ledger';

/**
 * 账目, served out of one mutable store per `?session=`.
 *
 * The month summary is computed from the entries on every read rather than
 * stored beside them, which is the whole point of the fixture: an entry that
 * is added, or reversed, has to move the totals, the category list and the
 * customer's margin, or the flows this page is tested by are testing nothing.
 *
 * The rate table is the other half. It carries one rate per day from the
 * start of last month to today, so three cases are all reachable from the
 * drawer: a day that has a rate, a day past the end of the table — which
 * answers with the newest rate it does have, and says which day that was —
 * and a day before the table starts, which is refused with the code the
 * console has a sentence for.
 */

const DAY = 86_400;
const GB = 1_073_741_824;

type SeedEntry = {
  kind: LedgerKind;
  category: LedgerCategory;
  subjectType: LedgerSubjectType;
  subjectId: string | null;
  amount: string;
  currency: string;
  /** Day of the month it was paid on. */
  day: number;
  note: string | null;
};

type Seed = {
  fx: Record<string, number>;
  fxSource: string;
  pendingCustomers: string[];
  customerCosts: Array<{ userId: string; cnyMinor: number }>;
  nodes: Array<{ name: string; bytes: number | null; pending: boolean }>;
  entries: SeedEntry[];
};

type Store = {
  entries: LedgerEntryDto[];
  closed: Map<string, { closedAt: number; closedBy: string }>;
  seeded: boolean;
};

type Request = {
  req: IncomingMessage;
  res: ServerResponse;
  route: string;
  url: string;
  session: string;
  empty: boolean;
  /** The customer list the rest of the console shows, for names and emails. */
  customers: () => Array<{ userId: string; email: string }>;
};

const DECIMALS: Record<string, number> = { JPY: 0, KRW: 0 };

function decimalsOf(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? 2;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function dayOf(seconds: number): string {
  const date = new Date(seconds * 1_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthOf(seconds: number): string {
  const date = new Date(seconds * 1_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendRefusal(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, { error: { code, message } }, status);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    let raw = '';
    req.on('data', (chunk) => { raw += String(chunk); });
    req.on('end', () => {
      try {
        done(JSON.parse(raw || '{}') as Record<string, unknown>);
      } catch {
        done({});
      }
    });
  });
}

let counter = 0;

function newId(): string {
  counter += 1;
  return `led_fixture${String(counter).padStart(10, '0')}`;
}

export function createLedgerFixtures(rootDir: string) {
  const seed = JSON.parse(
    readFileSync(path.resolve(rootDir, 'fixtures/ledger.json'), 'utf8'),
  ) as Seed;
  const stores = new Map<string, Store>();

  /** One rate per day, from the first of last month to today. */
  function rateTable(): Map<string, Map<string, number>> {
    const table = new Map<string, Map<string, number>>();
    const today = nowSec();
    const start = new Date(today * 1_000);
    start.setMonth(start.getMonth() - 1, 1);
    for (let at = Math.floor(start.getTime() / 1_000); at <= today; at += DAY) {
      table.set(dayOf(at), new Map(Object.entries(seed.fx)));
    }
    return table;
  }

  /** The rate for a day, or the newest one before it; null before the table starts. */
  function rateFor(day: string, base: string): FxRateDto | null {
    if (base.toUpperCase() === 'CNY') {
      return { day, base: 'CNY', quote: 'CNY', rate: 1, fetchedAt: nowSec(), source: seed.fxSource };
    }
    const table = rateTable();
    const days = [...table.keys()].sort();
    const usable = days.filter((row) => row <= day);
    const found = usable.length === 0 ? null : usable[usable.length - 1];
    const rate = found === null ? undefined : table.get(found)?.get(base.toUpperCase());
    if (found === null || rate === undefined) return null;
    return {
      day: found,
      base: base.toUpperCase(),
      quote: 'CNY',
      rate,
      fetchedAt: nowSec(),
      source: seed.fxSource,
    };
  }

  function toCnyMinor(minor: number, currency: string, rate: number): number {
    if (currency.toUpperCase() === 'CNY') return Math.round(minor);
    return Math.round((minor / 10 ** decimalsOf(currency)) * rate * 100);
  }

  function storeFor(session: string, empty: boolean): Store {
    const key = `${session}/${empty ? 'empty' : 'normal'}`;
    const found = stores.get(key);
    if (found) return found;
    const made: Store = { entries: empty ? [] : seedEntries(), closed: new Map(), seeded: !empty };
    stores.set(key, made);
    return made;
  }

  function seedEntries(): LedgerEntryDto[] {
    const at = nowSec();
    const month = monthOf(at);
    const start = new Date(at * 1_000);
    start.setDate(1);
    start.setHours(10, 0, 0, 0);
    const first = Math.floor(start.getTime() / 1_000);
    return seed.entries.map((row, index) => {
      const paidAt = first + (row.day - 1) * DAY;
      const day = dayOf(paidAt);
      const fx = rateFor(day, row.currency);
      const amountMinor = Math.round(Number(row.amount) * 10 ** decimalsOf(row.currency));
      const rate = fx?.rate ?? 1;
      return {
        id: `led_seed${String(index + 1).padStart(4, '0')}`,
        kind: row.kind,
        category: row.category,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        amountMinor,
        currency: row.currency,
        fxRateToCny: rate,
        fxDate: row.currency.toUpperCase() === 'CNY' ? null : (fx?.day ?? day),
        cnyMinor: toCnyMinor(amountMinor, row.currency, rate),
        month,
        paidAt,
        note: row.note,
        reverses: null,
        reversedBy: null,
        createdBy: 'owner@example.test',
        createdAt: paidAt,
      };
    });
  }

  /** Revenue counts up, a refund or a credit counts back down, a cost counts up. */
  function signed(row: LedgerEntryDto): number {
    return row.kind === 'refund' || row.kind === 'credit' ? -row.cnyMinor : row.cnyMinor;
  }

  function summarise(store: Store, month: string, emails: Map<string, string>): MonthSummaryDto {
    const rows = store.entries.filter((row) => row.month === month);
    let revenue = 0;
    let cost = 0;
    const byCategory: Partial<Record<LedgerCategory, number>> = {};
    for (const row of rows) {
      if (row.kind === 'cost') cost += row.cnyMinor;
      else revenue += signed(row);
      byCategory[row.category] = (byCategory[row.category] ?? 0) + signed(row);
    }

    const perUser = new Map<string, number>();
    for (const row of rows) {
      if (row.subjectType !== 'user' || row.subjectId === null) continue;
      perUser.set(row.subjectId, (perUser.get(row.subjectId) ?? 0) + signed(row));
    }
    const seededCost = new Map(seed.customerCosts.map((row) => [row.userId, row.cnyMinor]));
    const customers = [...perUser.entries()].map(([userId, earned]) => {
      const spent = seededCost.get(userId) ?? 0;
      const pending = seed.pendingCustomers.includes(userId);
      return {
        userId,
        email: emails.get(userId) ?? userId,
        revenueCnyMinor: earned,
        costCnyMinor: spent,
        marginCnyMinor: pending ? null : earned - spent,
        pending,
      };
    });

    const nodes = seed.nodes.map((row) => {
      const spent = rows
        .filter((entry) => entry.subjectType === 'node' && entry.subjectId === row.name)
        .reduce((sum, entry) => sum + entry.cnyMinor, 0);
      const usable = !row.pending && row.bytes !== null && row.bytes > 0;
      return {
        name: row.name,
        costCnyMinor: spent,
        bytes: row.bytes,
        cnyPerGbMinor: usable ? Math.round(spent / ((row.bytes ?? 0) / GB)) : null,
        pending: row.pending,
      };
    }).filter((row) => row.costCnyMinor !== 0 || row.pending);

    const shut = store.closed.get(month) ?? null;
    const billsWithoutLedger = store.seeded && month === monthOf(nowSec()) ? [{
      subjectType: 'node' as const,
      subjectId: 'Osaka · Kita',
      label: 'Osaka · Kita',
      category: 'server' as const,
      ownerUserId: null,
      expectedMinor: 8_000,
      expectedCurrency: 'USD',
      ledgerCnyMinor: null,
      entryIds: [] as string[],
      reason: 'no_ledger' as const,
    }] : [];
    return {
      month,
      closedAt: shut?.closedAt ?? null,
      closedBy: shut?.closedBy ?? null,
      revenueCnyMinor: revenue,
      costCnyMinor: cost,
      marginCnyMinor: revenue - cost,
      byCategory,
      customers,
      nodes,
      unreconciled: customers.filter((row) => row.pending).length
        + nodes.filter((row) => row.pending).length,
      reconciliation: { billsWithoutLedger, ledgerWithoutBill: [], asOfSec: nowSec() },
      unreconciledBills: billsWithoutLedger.length,
      updatedAt: rows.reduce((newest, row) => Math.max(newest, row.createdAt), nowSec()),
    };
  }

  function csv(store: Store, month: string): string {
    const cell = (value: string | number | null) => {
      const text = value === null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const head = ['日期', '类型', '类目', '对象', '原币金额', '币种', '汇率', '汇率日', '折人民币', '备注'];
    const lines = [head.join(',')];
    for (const row of store.entries.filter((entry) => entry.month === month)) {
      lines.push([
        row.paidAt === null ? '' : dayOf(row.paidAt),
        row.kind,
        row.category,
        row.subjectId ?? 'fleet',
        (row.amountMinor / 10 ** decimalsOf(row.currency)).toFixed(decimalsOf(row.currency)),
        row.currency,
        row.fxRateToCny,
        row.fxDate ?? '',
        (row.cnyMinor / 100).toFixed(2),
        row.note ?? '',
      ].map(cell).join(','));
    }
    return `﻿${lines.join('\n')}\n`;
  }

  function create(store: Store, body: Record<string, unknown>, res: ServerResponse): void {
    const kind = (body.kind as LedgerKind) ?? 'cost';
    // Money coming in is only ever yuan; a bill defaults to what the invoices
    // are actually in. Both halves are the hub's rule, kept here so the
    // drawer's locked field is tested against a server that enforces it rather
    // than one that would have taken anything.
    const currency = String(body.currency ?? (kind === 'cost' ? 'USD' : 'CNY'));
    if (kind !== 'cost' && currency.toUpperCase() !== 'CNY') {
      sendRefusal(res, 400, 'VALIDATION_ERROR', '收款只收人民币');
      return;
    }
    const paidAt = typeof body.paidAt === 'number' ? body.paidAt : null;
    const day = dayOf(paidAt ?? nowSec());
    const fx = rateFor(day, currency);
    if (fx === null) {
      sendRefusal(res, 409, 'FX_RATE_MISSING', `${day} 的汇率还没拉到`);
      return;
    }
    const month = String(body.month ?? monthOf(nowSec()));
    if (store.closed.has(month)) {
      sendRefusal(res, 409, 'MONTH_CLOSED', '这个月已经锁了，只能冲正，不能改');
      return;
    }
    const amountMinor = Math.round(Number(body.amountMinor ?? 0));
    const row: LedgerEntryDto = {
      id: newId(),
      kind,
      category: (body.category as LedgerCategory) ?? 'other',
      subjectType: (body.subjectType as LedgerSubjectType) ?? 'fleet',
      subjectId: typeof body.subjectId === 'string' ? body.subjectId : null,
      amountMinor,
      currency,
      fxRateToCny: fx.rate,
      fxDate: currency.toUpperCase() === 'CNY' ? null : fx.day,
      cnyMinor: toCnyMinor(amountMinor, currency, fx.rate),
      month,
      paidAt,
      note: typeof body.note === 'string' && body.note !== '' ? body.note : null,
      reverses: null,
      reversedBy: null,
      createdBy: 'owner@example.test',
      createdAt: nowSec(),
    };
    store.entries.push(row);
    sendJson(res, row, 201);
  }

  /** The reversal lands in the month it is made in, never in the month it undoes. */
  function reverse(store: Store, row: LedgerEntryDto, res: ServerResponse): void {
    if (row.reversedBy !== null) {
      sendRefusal(res, 409, 'ALREADY_REVERSED', '这一笔已经冲正过了');
      return;
    }
    const at = nowSec();
    const mirror: LedgerEntryDto = {
      ...row,
      id: newId(),
      amountMinor: -row.amountMinor,
      cnyMinor: -row.cnyMinor,
      month: monthOf(at),
      paidAt: at,
      reverses: row.id,
      reversedBy: null,
      createdAt: at,
    };
    row.reversedBy = mirror.id;
    store.entries.push(mirror);
    sendJson(res, mirror, 201);
  }

  return function ledgerFixtures(options: Request): boolean {
    const parts = options.route.split('/').map(decodeURIComponent);
    if (parts[0] !== 'ledger' && parts[0] !== 'months' && parts[0] !== 'fx') return false;
    const { req, res } = options;
    const query = new URLSearchParams(options.url.split('?')[1] ?? '');
    const store = storeFor(options.session, options.empty);
    const method = req.method ?? 'GET';
    const emails = new Map(options.customers().map((row) => [row.userId, row.email]));

    if (parts[0] === 'fx' && method === 'GET') {
      const day = query.get('day') ?? dayOf(nowSec());
      const found = rateFor(day, query.get('base') ?? 'CNY');
      if (found === null) {
        sendRefusal(res, 409, 'FX_RATE_MISSING', `${day} 的汇率还没拉到`);
        return true;
      }
      sendJson(res, found);
      return true;
    }

    if (parts[0] === 'ledger' && parts.length === 1) {
      if (method === 'GET') {
        const month = query.get('month') ?? monthOf(nowSec());
        const items = store.entries.filter((row) => row.month === month);
        sendJson(res, {
          items,
          nextCursor: null,
          total: items.length,
          updatedAt: items.reduce((newest, row) => Math.max(newest, row.createdAt), nowSec()),
        });
        return true;
      }
      if (method === 'POST') {
        void readBody(req).then((body) => create(store, body, res));
        return true;
      }
      return false;
    }

    if (parts[0] === 'ledger') {
      const row = store.entries.find((entry) => entry.id === parts[1]);
      if (!row) {
        sendRefusal(res, 404, 'NOT_FOUND', options.route);
        return true;
      }
      if (parts[2] === 'reverse' && method === 'POST') {
        reverse(store, row, res);
        return true;
      }
      if (parts.length === 2 && method === 'PATCH') {
        if (store.closed.has(row.month)) {
          sendRefusal(res, 409, 'MONTH_CLOSED', '这个月已经锁了，只能冲正，不能改');
          return true;
        }
        void readBody(req).then((body) => {
          row.note = typeof body.note === 'string' && body.note !== '' ? body.note : null;
          sendJson(res, row);
        });
        return true;
      }
      return false;
    }

    const month = parts[1] ?? monthOf(nowSec());
    if (parts[2] === 'export.csv' && method === 'GET') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="ledger-${month}.csv"`);
      res.setHeader('cache-control', 'no-store');
      res.end(csv(store, month));
      return true;
    }
    if (parts[2] === 'close' && method === 'POST') {
      if (store.closed.has(month)) {
        sendRefusal(res, 409, 'MONTH_CLOSED', '这个月已经锁了');
        return true;
      }
      store.closed.set(month, { closedAt: nowSec(), closedBy: 'owner@example.test' });
      sendJson(res, summarise(store, month, emails));
      return true;
    }
    if (parts.length === 2 && method === 'GET') {
      sendJson(res, summarise(store, month, emails));
      return true;
    }
    return false;
  };
}
