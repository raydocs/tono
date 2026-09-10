// 可售验收单：一台新机器凭什么可以上架。
//
// Everything on the sheet is read off facts the Worker already keeps — the
// profile, the five registrations, the hub's sweep, the customers' own connect
// events, the error digest, the traffic cycle, the catalog — and nothing is
// inferred from a fact that was never measured. That distinction is the whole
// point of it: 全部有勾 has never meant a 大陆 customer can use the machine,
// because half of the ticks only ever proved that some job had run once.
//
// This file does the reading and the assembling; `nodes-acceptance-items.ts`
// decides what each fact means.

import { ApiError } from '../../errors';
import type { AcceptanceItemDto, NodeAcceptanceDto } from '../contract';
import { assertNodeAcceptance } from '../contract';
import { liveQualityNodeNamed } from '../live';
import {
  Env,
  Row,
  auditWrite,
  decodeName,
  entityJson,
  missingTable,
  now,
  nullInt,
  nullText,
  weakEtag,
} from './common';
import {
  CUSTOMER_WINDOW_SEC,
  DAY,
  DIGEST_TYPES,
  NEEDS_A_CUSTOMER,
  bindingItems,
  capacityItem,
  carriersItem,
  errorsItem,
  forwardItem,
  profileItem,
  quotaItem,
  standbyItem,
} from './nodes-acceptance-items';
import {
  bindingsOf,
  catalogNames,
  factsFrom,
  forwardPath,
  occupancy,
  quotaDto,
  recentErrors,
  requireNode,
  returnPath,
} from './nodes-data';

/* ------------------------------------------------------------------ 读取 */

type JobFacts = { probePending: boolean; digestAt: number | null };

/** One pass over the queue for the two questions it answers on this sheet. */
async function jobFacts(e: Env, name: string): Promise<JobFacts> {
  try {
    const rows = await e.DB.prepare(
      `SELECT type, status, MAX(COALESCE(completed_at, created_at)) AS at
       FROM ops_node_jobs
       WHERE node_name = ? AND type IN ('node_probe', 'xray_error_digest', 'xray_dial_errors')
       GROUP BY type, status`,
    ).bind(name).all<Row>();
    let probePending = false;
    let digestAt: number | null = null;
    for (const row of rows.results ?? []) {
      const type = String(row.type);
      const status = String(row.status);
      if (type === 'node_probe' && (status === 'queued' || status === 'leased')) probePending = true;
      if (DIGEST_TYPES.includes(type) && status === 'succeeded') {
        const at = nullInt(row.at);
        if (at !== null && at > 0) digestAt = Math.max(digestAt ?? 0, at);
      }
    }
    return { probePending, digestAt };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { probePending: false, digestAt: null };
  }
}

/** Every other node the catalog is still selling, folded on its written region. */
async function listedSiblings(e: Env, name: string, region: string | null): Promise<{
  names: Set<string> | null;
  siblings: string[];
}> {
  const names = await catalogNames(e);
  if (names === null || region === null) return { names, siblings: [] };
  const want = region.trim().toLowerCase();
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      'SELECT catalog_name, region FROM ops_node_profiles WHERE status = ? AND region IS NOT NULL',
    ).bind('active').all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const siblings: string[] = [];
  for (const row of rows) {
    const other = String(row.catalog_name);
    if (other === name || !names.has(other)) continue;
    if ((nullText(row.region) ?? '').trim().toLowerCase() === want) siblings.push(other);
  }
  return { names, siblings: siblings.sort() };
}

const BLOCK_LABELS: Record<string, string> = {
  LIKELY_BLOCKED: '疑似被墙',
  DOWN: '整机失联',
  DEGRADED: '线路劣化',
  EDGE_FAIL: '边缘握不上手',
  CHECK_FAILED: '这一轮检查没跑完',
};

/** The sweep's own verdict, only when it is one an operator should act on. */
async function blockLabelFor(e: Env, name: string): Promise<string | null> {
  const node = await liveQualityNodeNamed(e, name);
  if (!node) return null;
  const block = node.block && typeof node.block === 'object' ? node.block as Row : null;
  const status = nullText(block?.status);
  if (node.ok !== true) return BLOCK_LABELS.DOWN;
  if (status === null) return null;
  return BLOCK_LABELS[status] ?? null;
}

/**
 * The whole sheet for one node.
 *
 * `ctx` is what `requireNode` already loaded, so the acceptance read and the
 * relist gate share one lookup rather than asking the catalog twice.
 */
export async function nodeAcceptance(
  e: Env,
  name: string,
  ctx: { profile: Row | null; listed: boolean | null; agent: Row | null },
): Promise<NodeAcceptanceDto> {
  const t = now();
  const facts = factsFrom(ctx.profile, ctx.agent, nullInt(ctx.profile?.updated_at) ?? t);
  const [quota, forward, occ, errors, bindings, jobs, block, catalog] = await Promise.all([
    quotaDto(e, name, ctx.profile),
    forwardPath(e, name, t - CUSTOMER_WINDOW_SEC),
    occupancy(e, name),
    recentErrors(e, name, t - 2 * DAY),
    bindingsOf(e, name, ctx.listed, ctx.agent),
    jobFacts(e, name),
    blockLabelFor(e, name),
    listedSiblings(e, name, facts.region),
  ]);
  const ret = returnPath(ctx.agent);

  const items: AcceptanceItemDto[] = [
    profileItem(facts),
    ...bindingItems(bindings, ctx.listed),
    carriersItem(ret, block, jobs.probePending, t),
    forwardItem(forward),
    errorsItem(errors.rows, jobs.digestAt, t),
    quotaItem(quota.dto, quota.asOf),
    capacityItem(occ),
    standbyItem(facts.region, catalog.siblings, catalog.names, t),
  ];

  const blockers = items
    .filter((row) => row.state !== 'pass' && !(row.state === 'unknown' && NEEDS_A_CUSTOMER.has(row.key)))
    .map((row) => row.key);
  const asOfSec = items.reduce<number | null>(
    (latest, row) => (row.asOfSec === null ? latest : Math.max(latest ?? 0, row.asOfSec)),
    null,
  );
  return { items, sellable: blockers.length === 0, blockers, asOfSec };
}

export async function getNodeAcceptance(req: Request, e: Env, rawName: string): Promise<Response> {
  const name = decodeName(rawName);
  const ctx = await requireNode(e, name);
  const dto = await nodeAcceptance(e, name, ctx);
  return entityJson(
    e, req, dto,
    weakEtag([name, dto.asOfSec, dto.blockers.join('|')]),
    assertNodeAcceptance,
  );
}

/**
 * What 上架 is allowed to do.
 *
 * The console already shows this sheet, so the refusal here is not the place
 * the operator learns about the blockers — it is the side that owns the
 * catalog saying no to anything that did not read the sheet first, including a
 * script. `override: true` is the deliberate second path: it goes through,
 * and it is written down with the exact list it went through.
 */
export async function relistGate(
  e: Env,
  name: string,
  type: string,
  override: unknown,
): Promise<{ refusal: Response | null; overridden: string[] }> {
  if (type !== 'catalog_relist') {
    // Nothing else has a sheet to read, so an `override` on it is a caller
    // that thinks it waived something. Say so rather than quietly ignoring it.
    if (override !== undefined) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'override applies to catalog_relist only');
    }
    return { refusal: null, overridden: [] };
  }
  if (override !== undefined && typeof override !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid override');
  }
  const ctx = await requireNode(e, name);
  const sheet = await nodeAcceptance(e, name, ctx);
  if (sheet.sellable) return { refusal: null, overridden: [] };
  if (override === true) return { refusal: null, overridden: sheet.blockers };
  return {
    refusal: Response.json(
      {
        error: {
          code: 'NOT_SELLABLE',
          message: `${name} 还差 ${sheet.blockers.length} 项验收，不能上架`,
        },
        blockers: sheet.blockers,
      },
      { status: 409, headers: { 'cache-control': 'no-store' } },
    ),
    overridden: sheet.blockers,
  };
}

/**
 * The override, written down.
 *
 * The enqueue is already audited as `node.job.enqueue`; this is the second
 * line, and it is the only record of what the sheet said at the moment
 * somebody decided to sell the machine anyway.
 */
export async function auditRelistOverride(
  e: Env,
  actorEmail: string,
  name: string,
  blockers: readonly string[],
): Promise<void> {
  if (blockers.length === 0) return;
  await auditWrite(
    e, actorEmail, 'node.relist.override', 'node', name,
    `relisted ${name} past ${blockers.join(', ')}`.slice(0, 500),
  );
}
