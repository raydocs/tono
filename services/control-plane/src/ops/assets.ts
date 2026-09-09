import { type Row, id, now, str } from '../env';
import { ApiError } from '../errors';
import {
  httpsUrlField,
  optionalNotes,
  optionalUnix,
  publicNodeProfile,
} from '../product-account';

type Db = D1Database;

const CLOUD_KINDS = ['vps', 'cloudflare', 'domain_registrar', 'residential', 'other'] as const;
const ACCOUNT_STATUSES = ['active', 'closed'] as const;
const QUOTA_COUNTS = ['in', 'out', 'in_out'] as const;
const CYCLE_KINDS = ['calendar_day', 'anniversary', 'rolling_30d', 'manual'] as const;
const MAX_LINE_TAGS = 20;
const MAX_TAG_LEN = 40;

export type CloudKind = typeof CLOUD_KINDS[number];
export type AccountStatus = typeof ACCOUNT_STATUSES[number];
export type QuotaCounts = typeof QUOTA_COUNTS[number];
export type CycleKind = typeof CYCLE_KINDS[number];

export type ProviderAccountInput = {
  provider: string;
  label: string;
  cloudKind?: CloudKind | string | null;
  loginEmail?: string | null;
  billingUrl?: string | null;
  balanceHint?: string | null;
  renewNotes?: string | null;
  secretRef?: string | null;
  status?: AccountStatus | string | null;
};

export type ProviderAccountPatch = Partial<ProviderAccountInput>;

export type NodeProfileAssetPatch = {
  providerAccountId?: string | null;
  expiresAt?: number | null;
  os?: string | null;
  region?: string | null;
  lineTags?: string[] | null;
  quotaCounts?: QuotaCounts | string | null;
  cycleKind?: CycleKind | string | null;
  cycleAnchorDay?: number | null;
  autoUnlistAtPct?: number | null;
};

function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[], fallback?: T): T {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as T;
}

function optionalText(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return str(value, name, 1, max);
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

function maskedLogin(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = str(value, 'loginEmail', 3, 254).trim().toLowerCase();
  if (raw.includes('***')) return raw.slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid loginEmail');
  }
  return maskEmail(raw);
}

function lineTagsJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lineTags');
  }
  if (value.length > MAX_LINE_TAGS) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lineTags');
  }
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 1 || item.length > MAX_TAG_LEN) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lineTags');
    }
    tags.push(item);
  }
  return tags.length === 0 ? null : JSON.stringify(tags);
}

function parseLineTags(raw: unknown): string[] | undefined {
  if (raw == null || raw === '') return undefined;
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return undefined;
  }
}

function optionalPct(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

function optionalAnchorDay(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cycleAnchorDay');
  }
  return value as number;
}

export function publicProviderAccount(row: Row) {
  return {
    id: String(row.id),
    provider: String(row.provider),
    label: String(row.label),
    cloudKind: String(row.cloud_kind),
    loginEmailMasked: row.login_email_masked == null ? null : String(row.login_email_masked),
    billingUrl: row.billing_url == null ? null : String(row.billing_url),
    balanceHint: row.balance_hint == null || row.balance_hint === '' ? null : String(row.balance_hint),
    renewNotes: row.renew_notes == null || row.renew_notes === '' ? null : String(row.renew_notes),
    secretRef: row.secret_ref == null || row.secret_ref === '' ? null : String(row.secret_ref),
    status: String(row.status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function publicAssetProfile(row: Row) {
  return {
    ...publicNodeProfile(row),
    providerAccountId: row.provider_account_id == null ? null : String(row.provider_account_id),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    os: row.os == null || row.os === '' ? null : String(row.os),
    region: row.region == null || row.region === '' ? null : String(row.region),
    lineTags: parseLineTags(row.line_tags_json) ?? [],
    quotaCounts: row.quota_counts == null ? null : String(row.quota_counts),
    cycleKind: row.cycle_kind == null ? null : String(row.cycle_kind),
    cycleAnchorDay: row.cycle_anchor_day == null ? null : Number(row.cycle_anchor_day),
    autoUnlistAtPct: row.auto_unlist_at_pct == null ? null : Number(row.auto_unlist_at_pct),
  };
}

export async function listProviderAccounts(db: Db) {
  const q = await db.prepare(
    'SELECT * FROM provider_accounts ORDER BY status ASC, provider ASC, label ASC',
  ).all<Row>();
  return q.results.map(publicProviderAccount);
}

export async function getProviderAccount(db: Db, accountId: string) {
  const row = await db.prepare('SELECT * FROM provider_accounts WHERE id = ?').bind(accountId).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Provider account not found');
  return publicProviderAccount(row);
}

export async function createProviderAccount(db: Db, input: ProviderAccountInput) {
  const provider = str(input.provider, 'provider', 1, 80).trim();
  const label = str(input.label, 'label', 1, 120).trim();
  const cloudKind = oneOf(input.cloudKind, 'cloudKind', CLOUD_KINDS, 'vps');
  const status = oneOf(input.status, 'status', ACCOUNT_STATUSES, 'active');
  const accountId = id();
  const t = now();
  await db.prepare(
    `INSERT INTO provider_accounts(
       id, provider, label, cloud_kind, login_email_masked, billing_url,
       balance_hint, renew_notes, secret_ref, status, created_at, updated_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    accountId,
    provider,
    label,
    cloudKind,
    maskedLogin(input.loginEmail),
    httpsUrlField(input.billingUrl, 'billingUrl'),
    optionalText(input.balanceHint, 'balanceHint', 200),
    optionalNotes(input.renewNotes, 'renewNotes', 1000),
    optionalText(input.secretRef, 'secretRef', 120),
    status,
    t,
    t,
  ).run();
  return getProviderAccount(db, accountId);
}

export async function updateProviderAccount(db: Db, accountId: string, patch: ProviderAccountPatch) {
  const existing = await db.prepare('SELECT * FROM provider_accounts WHERE id = ?').bind(accountId).first<Row>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Provider account not found');
  const provider = patch.provider === undefined
    ? String(existing.provider)
    : str(patch.provider, 'provider', 1, 80).trim();
  const label = patch.label === undefined
    ? String(existing.label)
    : str(patch.label, 'label', 1, 120).trim();
  const cloudKind = patch.cloudKind === undefined
    ? String(existing.cloud_kind)
    : oneOf(patch.cloudKind, 'cloudKind', CLOUD_KINDS);
  const status = patch.status === undefined
    ? String(existing.status)
    : oneOf(patch.status, 'status', ACCOUNT_STATUSES);
  const t = now();
  await db.prepare(
    `UPDATE provider_accounts SET
       provider = ?, label = ?, cloud_kind = ?, login_email_masked = ?, billing_url = ?,
       balance_hint = ?, renew_notes = ?, secret_ref = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    provider,
    label,
    cloudKind,
    patch.loginEmail === undefined
      ? (existing.login_email_masked == null ? null : String(existing.login_email_masked))
      : maskedLogin(patch.loginEmail),
    patch.billingUrl === undefined
      ? (existing.billing_url == null ? null : String(existing.billing_url))
      : httpsUrlField(patch.billingUrl, 'billingUrl'),
    patch.balanceHint === undefined
      ? (existing.balance_hint == null ? null : String(existing.balance_hint))
      : optionalText(patch.balanceHint, 'balanceHint', 200),
    patch.renewNotes === undefined
      ? (existing.renew_notes == null ? null : String(existing.renew_notes))
      : optionalNotes(patch.renewNotes, 'renewNotes', 1000),
    patch.secretRef === undefined
      ? (existing.secret_ref == null ? null : String(existing.secret_ref))
      : optionalText(patch.secretRef, 'secretRef', 120),
    status,
    t,
    accountId,
  ).run();
  return getProviderAccount(db, accountId);
}

export async function closeProviderAccount(db: Db, accountId: string) {
  return updateProviderAccount(db, accountId, { status: 'closed' });
}

export async function patchNodeProfile(db: Db, profileId: string, patch: NodeProfileAssetPatch) {
  const existing = await db.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(profileId).first<Row>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Node profile not found');
  const providerAccountId = patch.providerAccountId === undefined
    ? (existing.provider_account_id == null ? null : String(existing.provider_account_id))
    : (patch.providerAccountId === null || patch.providerAccountId === ''
      ? null
      : str(patch.providerAccountId, 'providerAccountId', 1, 100));
  if (providerAccountId) {
    const account = await db.prepare('SELECT id FROM provider_accounts WHERE id = ?').bind(providerAccountId).first<Row>();
    if (!account) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown providerAccountId');
  }
  const expiresAt = patch.expiresAt === undefined
    ? (existing.expires_at == null ? null : Number(existing.expires_at))
    : optionalUnix(patch.expiresAt, 'expiresAt');
  const os = patch.os === undefined
    ? (existing.os == null ? null : String(existing.os))
    : optionalText(patch.os, 'os', 80);
  const region = patch.region === undefined
    ? (existing.region == null ? null : String(existing.region))
    : optionalText(patch.region, 'region', 80);
  const tagsJson = patch.lineTags === undefined
    ? (existing.line_tags_json == null ? null : String(existing.line_tags_json))
    : lineTagsJson(patch.lineTags);
  const quotaCounts = patch.quotaCounts === undefined
    ? (existing.quota_counts == null ? null : String(existing.quota_counts))
    : (patch.quotaCounts === null || patch.quotaCounts === ''
      ? null
      : oneOf(patch.quotaCounts, 'quotaCounts', QUOTA_COUNTS));
  const cycleKind = patch.cycleKind === undefined
    ? (existing.cycle_kind == null ? null : String(existing.cycle_kind))
    : (patch.cycleKind === null || patch.cycleKind === ''
      ? null
      : oneOf(patch.cycleKind, 'cycleKind', CYCLE_KINDS));
  const cycleAnchorDay = patch.cycleAnchorDay === undefined
    ? (existing.cycle_anchor_day == null ? null : Number(existing.cycle_anchor_day))
    : optionalAnchorDay(patch.cycleAnchorDay);
  const autoUnlistAtPct = patch.autoUnlistAtPct === undefined
    ? (existing.auto_unlist_at_pct == null ? null : Number(existing.auto_unlist_at_pct))
    : optionalPct(patch.autoUnlistAtPct, 'autoUnlistAtPct');
  const t = now();
  await db.prepare(
    `UPDATE ops_node_profiles SET
       provider_account_id = ?, expires_at = ?, os = ?, region = ?, line_tags_json = ?,
       quota_counts = ?, cycle_kind = ?, cycle_anchor_day = ?, auto_unlist_at_pct = ?,
       updated_at = ?
     WHERE id = ?`,
  ).bind(
    providerAccountId, expiresAt, os, region, tagsJson,
    quotaCounts, cycleKind, cycleAnchorDay, autoUnlistAtPct,
    t, profileId,
  ).run();
  const row = await db.prepare('SELECT * FROM ops_node_profiles WHERE id = ?').bind(profileId).first<Row>();
  return publicAssetProfile(row!);
}
