import { ApiError } from '../../errors';
import { CANDIDATE_STATUSES, assertDirectCandidate, type CandidateStatus, type DirectCandidateDto } from '../contract';
import { canonicalTrafficPolicy, publicTrafficPolicy, type TrafficPolicy } from '../../traffic-policy';
import {
  Actor,
  Env,
  Row,
  auditWrite,
  check,
  decodeName,
  jsonNoStore,
  listJson,
  missingTable,
  now,
  nullInt,
  nullText,
  weakEtag,
} from './common';

function candidateDto(row: Row): DirectCandidateDto {
  return {
    etld1: String(row.etld1),
    status: String(row.status) as CandidateStatus,
    firstSeen: Number(row.first_seen),
    users: Number(row.users) || 0,
    bytes30d: Number(row.bytes_30d) || 0,
    countryHint: nullText(row.country_hint),
    decidedBy: nullText(row.decided_by),
    decidedAt: nullInt(row.decided_at),
  };
}

export async function getDirectCandidates(req: Request, e: Env): Promise<Response> {
  const status = new URL(req.url).searchParams.get('status');
  if (status != null && status !== '' && !(CANDIDATE_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid status');
  }
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT * FROM direct_candidates
       WHERE (? = '' OR status = ?)
       ORDER BY bytes_30d DESC, etld1 ASC`,
    ).bind(status ?? '', status ?? '').all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const items = rows.map(candidateDto);
  const updatedAt = items.reduce((max, row) => Math.max(max, row.decidedAt ?? row.firstSeen), now());
  return listJson(
    e, req, items, null, updatedAt,
    weakEtag([updatedAt, items.length, status]),
    assertDirectCandidate, items.length,
  );
}

async function decide(
  e: Env, rawHost: string, status: 'accepted' | 'rejected', actor: Actor,
): Promise<Response> {
  const etld1 = decodeName(rawHost, 'etld1');
  const existing = await e.DB.prepare('SELECT * FROM direct_candidates WHERE etld1 = ?').bind(etld1).first<Row>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Candidate not found');
  const t = now();
  await e.DB.prepare(
    `UPDATE direct_candidates SET status = ?, decided_by = ?, decided_at = ? WHERE etld1 = ?`,
  ).bind(status, actor.email, t, etld1).run();
  await auditWrite(e, actor.email, `direct-candidate.${status === 'accepted' ? 'accept' : 'reject'}`, 'direct_candidate', etld1, status);
  const row = await e.DB.prepare('SELECT * FROM direct_candidates WHERE etld1 = ?').bind(etld1).first<Row>();
  const dto = candidateDto(row!);
  check(e, () => { assertDirectCandidate(dto); });
  return jsonNoStore(dto);
}

export async function postCandidateAccept(req: Request, e: Env, rawHost: string, actor: Actor): Promise<Response> {
  void req;
  return decide(e, rawHost, 'accepted', actor);
}

export async function postCandidateReject(req: Request, e: Env, rawHost: string, actor: Actor): Promise<Response> {
  void req;
  return decide(e, rawHost, 'rejected', actor);
}

export async function postDraftFromCandidates(req: Request, e: Env, actor: Actor): Promise<Response> {
  void req;
  let accepted: Row[] = [];
  try {
    accepted = (await e.DB.prepare(
      `SELECT etld1 FROM direct_candidates WHERE status = 'accepted' ORDER BY etld1`,
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const current = await publicTrafficPolicy(e);
  let policy: TrafficPolicy;
  try {
    policy = JSON.parse(current.json) as TrafficPolicy;
  } catch {
    policy = { version: 1, domains: [], mediaEndpoints: [] };
  }
  const suffixes = new Map<string, { host: string; ports: number[] }>();
  for (const entry of policy.directSuffixes ?? []) suffixes.set(entry.host, entry);
  for (const row of accepted) {
    const host = String(row.etld1).toLowerCase();
    if (!suffixes.has(host)) suffixes.set(host, { host, ports: [443] });
  }
  const draftInput = {
    version: 4 as const,
    domains: policy.domains,
    mediaEndpoints: policy.mediaEndpoints,
    webDomains: policy.webDomains ?? [],
    directSuffixes: [...suffixes.values()],
    tcpEndpoints: policy.tcpEndpoints ?? [],
  };
  let draft: unknown = draftInput;
  let note = 'draft only; not published';
  try {
    draft = canonicalTrafficPolicy(draftInput, true);
  } catch (error) {
    note = `canonicalisation skipped: ${error instanceof Error ? error.message : 'invalid draft'}`;
  }
  await auditWrite(e, actor.email, 'traffic-policy.draft-from-candidates', 'traffic_policy', null, `${accepted.length} accepted`);
  return jsonNoStore({ draft, note });
}
