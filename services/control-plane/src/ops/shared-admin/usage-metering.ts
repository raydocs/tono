import { ApiError } from '../../errors';
import {
  type Env,
  type Row,
  now,
} from '../../env';
import {
  opsAuditStatement,
} from '../../product-account';
import { rejectUnexpectedKeys, body } from '../../request';

export const USAGE_METERING_LEGACY_QUIET_SECONDS = 30 * 60;
export const USAGE_METERING_NODE_READY_SECONDS = 15 * 60;

export async function usageMeteringStatus(e: Env) {
  const timestamp = now();
  const [rollout, legacySources, namedSources, activeNodes, baselines] = await e.DB.batch([
    e.DB.prepare(
      `SELECT phase, legacy_last_seen_at, updated_at
       FROM usage_metering_rollout WHERE singleton_id = 1`,
    ),
    e.DB.prepare(
      `SELECT COUNT(*) AS source_rows,
              COUNT(DISTINCT user_id) AS users,
              COALESCE(SUM(accumulated_bytes), 0) AS accumulated_bytes,
              COALESCE(MAX(updated_at), 0) AS latest_update_at
       FROM usage_report_sources WHERE source_id = ''`,
    ),
    e.DB.prepare(
      `SELECT COUNT(*) AS source_rows,
              COUNT(DISTINCT user_id) AS users,
              COUNT(DISTINCT source_id) AS sources,
              SUM(CASE WHEN protocol_version = 2 THEN 1 ELSE 0 END) AS v2_rows,
              SUM(CASE WHEN protocol_version = 1 THEN 1 ELSE 0 END) AS v1_rows,
              COALESCE(SUM(accumulated_bytes), 0) AS accumulated_bytes,
              COALESCE(MAX(updated_at), 0) AS latest_update_at
       FROM usage_report_sources WHERE source_id != ''`,
    ),
    e.DB.prepare(
      `SELECT exit_nodes.id, exit_nodes.name,
              exit_nodes.metering_protocol_version,
              exit_nodes.metering_last_seen_at
       FROM exit_nodes
       WHERE exit_nodes.status = 'active'
       ORDER BY exit_nodes.name, exit_nodes.id`,
    ),
    e.DB.prepare('SELECT COUNT(*) AS count FROM usage_metering_cutover_baselines'),
  ]);
  const state = rollout.results[0] as Row | undefined;
  const legacy = legacySources.results[0] as Row | undefined;
  const named = namedSources.results[0] as Row | undefined;
  const nodes = activeNodes.results as Row[];
  const phase = state?.phase === 'v2_required' ? 'v2_required' : 'dual';
  const legacyLastSeenAt = Number(state?.legacy_last_seen_at ?? 0);
  const blockers: string[] = [];
  if (phase === 'dual') {
    // Silence is not a paired accounting boundary. Until the handoff protocol
    // exists, only installations with no legacy history may advance.
    if (legacyLastSeenAt > 0 || Number(legacy?.source_rows ?? 0) > 0) {
      blockers.push('legacy_handoff_boundary_unavailable');
    }
    if (nodes.length === 0) blockers.push('no_active_exit_nodes');
    if (nodes.some((node) =>
      Number(node.metering_protocol_version) !== 2 ||
      Number(node.metering_last_seen_at) <= timestamp - USAGE_METERING_NODE_READY_SECONDS
    )) {
      blockers.push('active_exit_without_v2_readiness');
    }
    if (legacyLastSeenAt > timestamp - USAGE_METERING_LEGACY_QUIET_SECONDS) {
      blockers.push('legacy_collector_recently_active');
    }
  }
  return {
    phase,
    updatedAt: Number(state?.updated_at ?? 0),
    legacyLastSeenAt: legacyLastSeenAt || null,
    legacyQuietSeconds: legacyLastSeenAt ? Math.max(0, timestamp - legacyLastSeenAt) : null,
    requiredLegacyQuietSeconds: USAGE_METERING_LEGACY_QUIET_SECONDS,
    legacy: {
      sourceRows: Number(legacy?.source_rows ?? 0),
      users: Number(legacy?.users ?? 0),
      accumulatedBytes: Number(legacy?.accumulated_bytes ?? 0),
      latestUpdateAt: Number(legacy?.latest_update_at ?? 0) || null,
    },
    named: {
      sourceRows: Number(named?.source_rows ?? 0),
      users: Number(named?.users ?? 0),
      sources: Number(named?.sources ?? 0),
      v1Rows: Number(named?.v1_rows ?? 0),
      v2Rows: Number(named?.v2_rows ?? 0),
      accumulatedBytes: Number(named?.accumulated_bytes ?? 0),
      latestUpdateAt: Number(named?.latest_update_at ?? 0) || null,
    },
    activeNodes: nodes.map((node) => ({
      id: String(node.id),
      name: String(node.name),
      v2Ready:
        Number(node.metering_protocol_version) === 2 &&
        Number(node.metering_last_seen_at) > timestamp - USAGE_METERING_NODE_READY_SECONDS,
      lastV2At: Number(node.metering_last_seen_at) || null,
    })),
    cutoverBaselineUsers: Number((baselines.results[0] as Row | undefined)?.count ?? 0),
    canRequireV2: phase === 'dual' && blockers.length === 0,
    blockers,
  };
}

export async function usageMeteringResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
): Promise<Response | null> {
  if (resource === 'usage-metering-rollout' && m === 'GET') {
    return Response.json(await usageMeteringStatus(e));
  }
  if (resource === 'usage-metering-rollout' && m === 'POST') {
    const b = await body(req, 4 * 1024);
    rejectUnexpectedKeys(b, ['phase']);
    if (b.phase !== 'v2_required') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Rollout may only advance to v2_required');
    }
    const state = await usageMeteringStatus(e);
    if (state.phase === 'v2_required') return Response.json(state);
    if (!state.canRequireV2) {
      throw new ApiError(
        409,
        'METERING_ROLLOUT_NOT_READY',
        `Metering v2 is not ready: ${state.blockers.join(', ')}`,
      );
    }
    const t = now();
    let changed: D1Result;
    try {
      const results = await e.DB.batch([
        e.DB.prepare(
          `INSERT INTO usage_metering_cutover_baselines(
             user_id, reported_bytes, named_bytes, cutover_at
           )
           SELECT users.id,
                  users.usage_reported_bytes,
                  COALESCE((
                    SELECT SUM(accumulated_bytes)
                    FROM usage_report_sources
                    WHERE usage_report_sources.user_id = users.id
                      AND usage_report_sources.source_id != ''
                  ), 0),
                  ?
           FROM users
           WHERE true
           ON CONFLICT(user_id) DO NOTHING`,
        ).bind(t),
        e.DB.prepare(
          `UPDATE usage_metering_rollout
           SET phase = 'v2_required', updated_at = ?
           WHERE singleton_id = 1 AND phase = 'dual'`,
        ).bind(t),
        opsAuditStatement(
          e,
          actorEmail,
          'usage-metering.require-v2',
          'usage_metering_rollout',
          '1',
          'legacy collector disabled; named protocol v2 required',
          true,
        ),
      ]);
      changed = results[1];
    } catch (error) {
      if (String(error).includes('USAGE_METERING_ROLLOUT_NOT_READY')) {
        throw new ApiError(
          409,
          'METERING_ROLLOUT_NOT_READY',
          'Metering readiness changed; inspect rollout state and retry',
        );
      }
      throw error;
    }
    if (!changed.meta.changes) return Response.json(await usageMeteringStatus(e));
    return Response.json(await usageMeteringStatus(e));
  }
  return null;
}
