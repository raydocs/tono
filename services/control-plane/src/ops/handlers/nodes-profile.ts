// PATCH nodes/{name}/profile: the hand-kept half of a machine.

import { str } from '../../env';
import { ApiError } from '../../errors';
import { rejectUnexpectedKeys } from '../../request';
import { QUOTA_COUNTS, QUOTA_CYCLE_KINDS } from '../contract';
import { catalogNameExists, upsertNodeIdentity } from '../node-identity';
import { closeOpenCycle, readAgentNetCounters, rollNodeCycle } from '../quota';
import {
  Env,
  Row,
  id,
  now,
  nullInt,
  nullNum,
  nullText,
} from './common';
import { loadProfile } from './nodes-data';

export const PROFILE_KEYS = [
  'provider', 'providerAccountId', 'region', 'lineTags', 'port', 'price',
  'currency', 'billingCycle', 'renewsAt', 'expiresAt', 'notes', 'quota',
  'capacityUsers', 'displayName', 'failureDomain', 'replaces',
];

type QuotaPatch = { quotaBytes: number; cycleKind: string; cycleAnchorDay: number; counts: string };
type ProfilePatch = {
  provider?: string | null; providerAccountId?: string | null; region?: string | null;
  lineTags?: string[] | null; price?: number | null; currency?: string | null;
  billingCycle?: number | null; renewsAt?: number | null; expiresAt?: number | null;
  notes?: string | null; quota?: QuotaPatch | null;
  capacityUsers?: number | null; displayName?: string | null;
  failureDomain?: string | null; replaces?: string | null;
};

function optionalText(value: unknown, name: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return str(value, name, 1, max);
}

function optionalInt(value: unknown, name: string, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  }
  return value as number;
}

function optionalPrice(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid price');
  }
  return value;
}

function optionalCurrency3(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid currency');
  }
  return value.toUpperCase();
}

function optionalLineTags(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 8) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lineTags');
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 1 || item.length > 32) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid lineTags');
    }
  }
  return value as string[];
}

function parseQuotaPatch(value: unknown): QuotaPatch | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  rejectUnexpectedKeys(value, ['quotaBytes', 'cycleKind', 'cycleAnchorDay', 'counts']);
  const quotaBytes = value.quotaBytes;
  if (!Number.isSafeInteger(quotaBytes) || (quotaBytes as number) < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid quotaBytes');
  }
  const cycleKind = String(value.cycleKind ?? '');
  if (!(QUOTA_CYCLE_KINDS as readonly string[]).includes(cycleKind)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cycleKind');
  }
  const cycleAnchorDay = value.cycleAnchorDay;
  if (!Number.isSafeInteger(cycleAnchorDay) || (cycleAnchorDay as number) < 1 || (cycleAnchorDay as number) > 31) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cycleAnchorDay');
  }
  const counts = String(value.counts ?? '');
  if (!(QUOTA_COUNTS as readonly string[]).includes(counts)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid counts');
  }
  return { quotaBytes: quotaBytes as number, cycleKind, cycleAnchorDay: cycleAnchorDay as number, counts };
}

function parseProfilePatch(b: Row): ProfilePatch {
  optionalInt(b.port, 'port', 1, 65_535);
  return {
    provider: optionalText(b.provider, 'provider', 80),
    providerAccountId: optionalText(b.providerAccountId, 'providerAccountId', 100),
    region: optionalText(b.region, 'region', 80),
    lineTags: optionalLineTags(b.lineTags),
    price: optionalPrice(b.price),
    currency: optionalCurrency3(b.currency),
    billingCycle: optionalInt(b.billingCycle, 'billingCycle', 1, 3660),
    renewsAt: optionalInt(b.renewsAt, 'renewsAt', 1, Number.MAX_SAFE_INTEGER),
    expiresAt: optionalInt(b.expiresAt, 'expiresAt', 1, Number.MAX_SAFE_INTEGER),
    notes: optionalText(b.notes, 'notes', 2000),
    quota: parseQuotaPatch(b.quota),
    capacityUsers: optionalInt(b.capacityUsers, 'capacityUsers', 1, 1_000_000),
    displayName: optionalText(b.displayName, 'displayName', 60),
    failureDomain: optionalText(b.failureDomain, 'failureDomain', 60),
    replaces: optionalText(b.replaces, 'replaces', 200),
  };
}

function pick<T>(patch: T | undefined, existing: T | null): T | null {
  return patch === undefined ? existing : patch;
}

export async function applyNodeProfilePatch(e: Env, name: string, body: Row): Promise<void> {
  const patch = parseProfilePatch(body);
  if (patch.replaces) {
    if (patch.replaces === name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'replaces cannot be this node');
    }
    if (!await catalogNameExists(e, patch.replaces)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown replaces');
    }
  }
  const t = now();
  if (patch.providerAccountId) {
    const account = await e.DB.prepare('SELECT id FROM provider_accounts WHERE id = ?')
      .bind(patch.providerAccountId).first<Row>();
    if (!account) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown providerAccountId');
  }
  const existing = await loadProfile(e, name);
  const tagsJson = patch.lineTags === undefined
    ? (existing?.line_tags_json == null ? null : String(existing.line_tags_json))
    : (patch.lineTags == null || patch.lineTags.length === 0 ? null : JSON.stringify(patch.lineTags));
  let quotaBytes = existing?.traffic_quota_bytes == null ? null : Number(existing.traffic_quota_bytes);
  let quotaCounts = nullText(existing?.quota_counts);
  let cycleKind = nullText(existing?.cycle_kind);
  let cycleAnchorDay = nullInt(existing?.cycle_anchor_day);
  if (patch.quota === null) {
    quotaBytes = null;
    quotaCounts = null;
    cycleKind = null;
    cycleAnchorDay = null;
  } else if (patch.quota) {
    quotaBytes = patch.quota.quotaBytes;
    quotaCounts = patch.quota.counts;
    cycleKind = patch.quota.cycleKind;
    cycleAnchorDay = patch.quota.cycleAnchorDay;
  }
  const provider = pick(patch.provider, nullText(existing?.provider));
  const providerAccountId = pick(patch.providerAccountId, nullText(existing?.provider_account_id));
  const region = pick(patch.region, nullText(existing?.region));
  const price = pick(patch.price, nullNum(existing?.price));
  const currency = pick(patch.currency, nullText(existing?.currency));
  const billingCycle = pick(patch.billingCycle, nullInt(existing?.billing_cycle));
  const renewsAt = pick(patch.renewsAt, nullInt(existing?.renews_at));
  const expiresAt = pick(patch.expiresAt, nullInt(existing?.expires_at));
  const notes = pick(patch.notes, nullText(existing?.notes));
  const capacityUsers = pick(patch.capacityUsers, nullInt(existing?.capacity_users));
  const failureDomain = pick(patch.failureDomain, nullText(existing?.failure_domain));
  const replaces = pick(patch.replaces, nullText(existing?.replaces));
  if (!existing) {
    await e.DB.prepare(
      `INSERT INTO ops_node_profiles(
         id, catalog_name, status, created_at, updated_at,
         provider, provider_account_id, region, line_tags_json, price, currency, billing_cycle,
         renews_at, expires_at, notes, traffic_quota_bytes, quota_counts, cycle_kind, cycle_anchor_day,
         capacity_users, failure_domain, replaces
       ) VALUES(?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id(), name, t, t,
      provider, providerAccountId, region, tagsJson, price, currency, billingCycle,
      renewsAt, expiresAt, notes, quotaBytes, quotaCounts, cycleKind, cycleAnchorDay,
      capacityUsers, failureDomain, replaces,
    ).run();
  } else {
    await e.DB.prepare(
      `UPDATE ops_node_profiles SET
         provider = ?, provider_account_id = ?, region = ?, line_tags_json = ?,
         price = ?, currency = ?, billing_cycle = ?, renews_at = ?, expires_at = ?, notes = ?,
         traffic_quota_bytes = ?, quota_counts = ?, cycle_kind = ?, cycle_anchor_day = ?,
         capacity_users = ?, failure_domain = ?, replaces = ?, updated_at = ?
       WHERE catalog_name = ?`,
    ).bind(
      provider, providerAccountId, region, tagsJson,
      price, currency, billingCycle, renewsAt, expiresAt, notes,
      quotaBytes, quotaCounts, cycleKind, cycleAnchorDay,
      capacityUsers, failureDomain, replaces, t, name,
    ).run();
  }
  await upsertNodeIdentity(e, name, t, patch.displayName);
  if (patch.quota === null) {
    await closeOpenCycle(e.DB, name, t);
  } else if (patch.quota) {
    const counters = await readAgentNetCounters(e.DB, name) ?? { in: 0, out: 0, at: t };
    await rollNodeCycle(e.DB, name, {
      trafficQuotaBytes: patch.quota.quotaBytes,
      cycleKind: patch.quota.cycleKind,
      cycleAnchorDay: patch.quota.cycleAnchorDay,
      quotaCounts: patch.quota.counts,
    }, counters, t);
  }
}
