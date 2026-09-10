import { ApiError } from '../../errors';
import { body, rejectUnexpectedKeys } from '../../request';
import { id as newId } from '../../env';
import {
  CLOUD_KINDS,
  assertHomeLine,
  assertHomeLineUsageDay,
  assertProviderAccount,
  type CloudKind,
  type HomeLineDto,
  type HomeLineUsageDayDto,
  type MeterSource,
  type ProviderAccountDto,
} from '../contract';
import {
  closeProviderAccount,
  createProviderAccount,
  getProviderAccount,
  listProviderAccounts,
  publicProviderAccount,
  updateProviderAccount,
} from '../assets';
import { patchHomeLine } from '../home-lines';
import {
  Actor,
  Env,
  Row,
  auditWrite,
  check,
  decodeName,
  jsonNoStore,
  listJson,
  measured,
  missingTable,
  now,
  nullInt,
  nullNum,
  nullText,
  parseRange,
  rangeSeconds,
  weakEtag,
} from './common';

function cloudKind(value: unknown): CloudKind {
  const text = nullText(value) ?? 'vps';
  if ((CLOUD_KINDS as readonly string[]).includes(text)) return text as CloudKind;
  return 'other';
}

async function nodeCount(e: Env, accountId: string): Promise<number> {
  try {
    const row = await e.DB.prepare(
      'SELECT COUNT(*) AS n FROM ops_node_profiles WHERE provider_account_id = ?',
    ).bind(accountId).first<Row>();
    return Number(row?.n ?? 0);
  } catch (error) {
    if (!missingTable(error)) throw error;
    return 0;
  }
}

async function providerDto(e: Env, row: ReturnType<typeof publicProviderAccount>): Promise<ProviderAccountDto> {
  return {
    id: row.id, provider: row.provider, label: row.label,
    cloudKind: cloudKind(row.cloudKind),
    loginEmailMasked: row.loginEmailMasked, billingUrl: row.billingUrl,
    balanceHint: row.balanceHint, renewNotes: row.renewNotes, secretRef: row.secretRef,
    nodeCount: await nodeCount(e, row.id),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export async function getProviderAccounts(req: Request, e: Env): Promise<Response> {
  const rows = await listProviderAccounts(e.DB);
  const items: ProviderAccountDto[] = [];
  for (const row of rows) items.push(await providerDto(e, row));
  const updatedAt = items.reduce((max, row) => Math.max(max, row.updatedAt), now());
  return listJson(e, req, items, null, updatedAt, weakEtag([updatedAt, items.length]), assertProviderAccount, items.length);
}

export async function getProviderAccountOne(req: Request, e: Env, rawId: string): Promise<Response> {
  void req;
  const row = await getProviderAccount(e.DB, decodeName(rawId, 'id'));
  const dto = await providerDto(e, row);
  check(e, () => { assertProviderAccount(dto); });
  return jsonNoStore(dto);
}

export async function postProviderAccount(req: Request, e: Env, actor: Actor): Promise<Response> {
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'provider', 'label', 'cloudKind', 'loginEmail', 'billingUrl', 'balanceHint', 'renewNotes', 'secretRef', 'status',
  ]);
  const created = await createProviderAccount(e.DB, {
    provider: String(b.provider), label: String(b.label),
    cloudKind: b.cloudKind as string | null | undefined,
    loginEmail: b.loginEmail as string | null | undefined,
    billingUrl: b.billingUrl as string | null | undefined,
    balanceHint: b.balanceHint as string | null | undefined,
    renewNotes: b.renewNotes as string | null | undefined,
    secretRef: b.secretRef as string | null | undefined,
  });
  await auditWrite(e, actor.email, 'provider-account.create', 'provider_account', created.id, created.label);
  const dto = await providerDto(e, created);
  check(e, () => { assertProviderAccount(dto); });
  return jsonNoStore(dto, 201);
}

export async function patchProviderAccount(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const idValue = decodeName(rawId, 'id');
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'provider', 'label', 'cloudKind', 'loginEmail', 'billingUrl', 'balanceHint', 'renewNotes', 'secretRef', 'status',
  ]);
  const updated = await updateProviderAccount(e.DB, idValue, {
    provider: b.provider as string | undefined,
    label: b.label as string | undefined,
    cloudKind: b.cloudKind as string | undefined,
    loginEmail: b.loginEmail as string | undefined,
    billingUrl: b.billingUrl as string | undefined,
    balanceHint: b.balanceHint as string | undefined,
    renewNotes: b.renewNotes as string | undefined,
    secretRef: b.secretRef as string | undefined,
    status: b.status as string | undefined,
  });
  await auditWrite(e, actor.email, 'provider-account.update', 'provider_account', idValue, updated.label);
  const dto = await providerDto(e, updated);
  check(e, () => { assertProviderAccount(dto); });
  return jsonNoStore(dto);
}

export async function deleteProviderAccount(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  void req;
  const idValue = decodeName(rawId, 'id');
  const closed = await closeProviderAccount(e.DB, idValue);
  await auditWrite(e, actor.email, 'provider-account.close', 'provider_account', idValue, closed.label);
  const dto = await providerDto(e, closed);
  check(e, () => { assertProviderAccount(dto); });
  return jsonNoStore(dto);
}

async function boundUsers(e: Env, homeId: string): Promise<{ n: number; asOf: number | null }> {
  try {
    const row = await e.DB.prepare(
      'SELECT COUNT(*) AS n FROM user_home_bindings WHERE home_exit_id = ?',
    ).bind(homeId).first<Row>();
    return { n: Number(row?.n ?? 0), asOf: now() };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { n: 0, asOf: null };
  }
}

async function homeLineDto(e: Env, row: Row): Promise<HomeLineDto> {
  const idValue = String(row.id);
  const t = now();
  const bound = await boundUsers(e, idValue);
  let usageValue: HomeLineDto['usage']['value'] = null;
  let usageAsOf: number | null = null;
  const source = (nullText(row.meter_source) ?? 'manual') as MeterSource;
  try {
    const usage = await e.DB.prepare(
      `SELECT SUM(bytes_up) AS bytes_up, SUM(bytes_down) AS bytes_down, SUM(users) AS users, MAX(updated_at) AS updated_at
       FROM home_line_usage_daily WHERE home_exit_id = ?`,
    ).bind(idValue).first<Row>();
    if (usage && (Number(usage.bytes_up) || Number(usage.bytes_down))) {
      usageValue = {
        bytesUp: Number(usage.bytes_up) || 0,
        bytesDown: Number(usage.bytes_down) || 0,
        users: Number(usage.users) || 0,
        source,
      };
      usageAsOf = nullInt(usage.updated_at);
    }
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const probeStatus = nullText(row.probe_status);
  const probeAsOf = nullInt(row.last_probed_at);
  return {
    id: idValue,
    proxyName: String(row.proxy_name),
    displayName: String(row.display_name),
    status: String(row.status),
    isp: nullText(row.isp),
    region: nullText(row.region),
    providerAccountId: nullText(row.provider_account_id),
    price: nullNum(row.price),
    currency: nullText(row.currency),
    billingKind: (nullText(row.billing_kind) as HomeLineDto['billingKind']),
    bundleBytes: nullInt(row.bundle_bytes),
    cycleStart: nullInt(row.cycle_start),
    cycleEnd: nullInt(row.cycle_end),
    expiresAt: nullInt(row.expires_at),
    meterSource: nullText(row.meter_source) as HomeLineDto['meterSource'],
    usage: measured(usageValue, usageAsOf, 'manual'),
    probe: measured(
      probeAsOf == null ? null : {
        alive: probeStatus === 'alive' ? 1 : 0,
        total: 1,
        uptimeRatio: probeStatus === 'alive' ? 1 : probeStatus === 'dead' ? 0 : null,
        status: probeStatus,
      },
      probeAsOf, 'collector',
    ),
    boundUsers: measured(bound.n, bound.asOf, 'manual'),
    notes: nullText(row.notes),
    createdAt: Number(row.created_at) || t,
    updatedAt: Number(row.updated_at) || t,
  };
}

export async function getHomeLines(req: Request, e: Env): Promise<Response> {
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare('SELECT * FROM home_exits ORDER BY display_name ASC, id ASC').all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items: HomeLineDto[] = [];
  for (const row of rows) items.push(await homeLineDto(e, row));
  const updatedAt = items.reduce((max, row) => Math.max(max, row.updatedAt), now());
  return listJson(e, req, items, null, updatedAt, weakEtag([updatedAt, items.length]), assertHomeLine, items.length);
}

async function loadHome(e: Env, idValue: string): Promise<Row> {
  const row = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(idValue).first<Row>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Home line not found');
  return row;
}

export async function getHomeLine(req: Request, e: Env, rawId: string): Promise<Response> {
  void req;
  const dto = await homeLineDto(e, await loadHome(e, decodeName(rawId, 'id')));
  check(e, () => { assertHomeLine(dto); });
  return jsonNoStore(dto);
}

export async function postHomeLine(req: Request, e: Env, actor: Actor): Promise<Response> {
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'proxyName', 'displayName', 'isp', 'region', 'providerAccountId', 'price', 'currency',
    'billingKind', 'bundleBytes', 'cycleStart', 'cycleEnd', 'expiresAt', 'meterSource', 'notes',
  ]);
  const t = now();
  const idValue = newId();
  await e.DB.prepare(
    `INSERT INTO home_exits(
       id, proxy_name, display_name, status, notes, created_at, updated_at,
       provider_account_id, isp, region, price, currency, billing_kind,
       bundle_bytes, cycle_start, cycle_end, expires_at, meter_source
     ) VALUES(?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    idValue, String(b.proxyName), String(b.displayName),
    b.notes == null ? null : String(b.notes), t, t,
    b.providerAccountId ?? null, b.isp ?? null, b.region ?? null,
    b.price ?? null, b.currency ?? null, b.billingKind ?? null,
    b.bundleBytes ?? null, b.cycleStart ?? null, b.cycleEnd ?? null,
    b.expiresAt ?? null, b.meterSource ?? null,
  ).run();
  await auditWrite(e, actor.email, 'home-line.create', 'home_exit', idValue, String(b.displayName));
  const dto = await homeLineDto(e, await loadHome(e, idValue));
  check(e, () => { assertHomeLine(dto); });
  return jsonNoStore(dto, 201);
}

export async function patchHomeLineRoute(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  const idValue = decodeName(rawId, 'id');
  await loadHome(e, idValue);
  const b = await body(req, 8 * 1024);
  rejectUnexpectedKeys(b, [
    'providerAccountId', 'isp', 'region', 'price', 'currency', 'billingKind',
    'bundleBytes', 'cycleStart', 'cycleEnd', 'expiresAt', 'meterSource', 'notes', 'displayName', 'status',
  ]);
  await patchHomeLine(e.DB, idValue, {
    providerAccountId: b.providerAccountId as string | null | undefined,
    isp: b.isp as string | null | undefined,
    region: b.region as string | null | undefined,
    price: b.price as number | null | undefined,
    currency: b.currency as string | null | undefined,
    billingKind: b.billingKind as never,
    bundleBytes: b.bundleBytes as number | null | undefined,
    cycleStart: b.cycleStart as number | null | undefined,
    cycleEnd: b.cycleEnd as number | null | undefined,
    expiresAt: b.expiresAt as number | null | undefined,
    meterSource: b.meterSource as never,
  }, now());
  if (b.notes !== undefined || b.displayName !== undefined || b.status !== undefined) {
    await e.DB.prepare(
      `UPDATE home_exits SET
         notes = CASE WHEN ? THEN ? ELSE notes END,
         display_name = CASE WHEN ? THEN ? ELSE display_name END,
         status = CASE WHEN ? THEN ? ELSE status END,
         updated_at = ?
       WHERE id = ?`,
    ).bind(
      b.notes !== undefined, b.notes == null ? null : String(b.notes),
      b.displayName !== undefined, b.displayName == null ? null : String(b.displayName),
      b.status !== undefined, b.status == null ? null : String(b.status),
      now(), idValue,
    ).run();
  }
  await auditWrite(e, actor.email, 'home-line.update', 'home_exit', idValue, 'patched');
  const dto = await homeLineDto(e, await loadHome(e, idValue));
  check(e, () => { assertHomeLine(dto); });
  return jsonNoStore(dto);
}

export async function deleteHomeLine(req: Request, e: Env, rawId: string, actor: Actor): Promise<Response> {
  void req;
  const idValue = decodeName(rawId, 'id');
  await loadHome(e, idValue);
  await e.DB.prepare(
    `UPDATE home_exits SET status = 'retired', updated_at = ? WHERE id = ?`,
  ).bind(now(), idValue).run();
  await auditWrite(e, actor.email, 'home-line.retire', 'home_exit', idValue, 'retired');
  const dto = await homeLineDto(e, await loadHome(e, idValue));
  check(e, () => { assertHomeLine(dto); });
  return jsonNoStore(dto);
}

export async function getHomeLineUsage(req: Request, e: Env, rawId: string): Promise<Response> {
  const idValue = decodeName(rawId, 'id');
  await loadHome(e, idValue);
  const range = parseRange(new URL(req.url).searchParams.get('range'));
  const from = now() - rangeSeconds(range);
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT day_at, source, bytes_up, bytes_down, users
       FROM home_line_usage_daily WHERE home_exit_id = ? AND day_at >= ?
       ORDER BY day_at DESC, source ASC`,
    ).bind(idValue, from).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items: HomeLineUsageDayDto[] = rows.map((row) => ({
    dayAt: Number(row.day_at),
    bytesUp: Number(row.bytes_up) || 0,
    bytesDown: Number(row.bytes_down) || 0,
    users: Number(row.users) || 0,
    source: String(row.source) as MeterSource,
  }));
  const updatedAt = items[0]?.dayAt ?? now();
  return listJson(e, req, items, null, updatedAt, weakEtag([idValue, range, items.length]), assertHomeLineUsageDay, items.length);
}
