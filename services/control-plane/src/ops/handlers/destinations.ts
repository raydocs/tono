import { ApiError } from '../../errors';
import {
  ROUTE_KINDS,
  assertFleetDestination,
  type FleetDestinationDto,
  type RouteKind,
} from '../contract';
import {
  type Env,
  type Row,
  listJson,
  missingTable,
  now,
  nullText,
  parseRange,
  rangeSeconds,
  weakEtag,
} from './common';

type SortKey = 'bytes' | 'stalls' | 'connections';

const ROUTE_SET = new Set<string>(ROUTE_KINDS);
const SORT_SQL: Record<SortKey, string> = {
  bytes: '(SUM(bytes_up) + SUM(bytes_down)) DESC, SUM(connections) DESC, etld1 ASC',
  stalls:
    'SUM(stalled_connections) DESC, CASE WHEN SUM(closed_connections) > 0 THEN CAST(SUM(stalled_connections) AS REAL) / SUM(closed_connections) ELSE 0 END DESC, SUM(connections) DESC, etld1 ASC',
  connections: 'SUM(connections) DESC, (SUM(bytes_up) + SUM(bytes_down)) DESC, etld1 ASC',
};

function parseRouteFilter(raw: string | null): RouteKind | null {
  if (!raw) return null;
  if (!ROUTE_SET.has(raw)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid route');
  }
  return raw as RouteKind;
}

function parseSort(raw: string | null): SortKey {
  if (!raw) return 'bytes';
  if (raw === 'bytes' || raw === 'stalls' || raw === 'connections') return raw;
  throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid sort');
}

function parseLimit(raw: string | null): number {
  if (!raw) return 50;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > 200) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid limit');
  }
  return n;
}

function splitDistinct(raw: unknown): string[] {
  const text = nullText(raw);
  if (!text) return [];
  const seen = new Set<string>();
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
    if (seen.size >= 6) break;
  }
  return [...seen];
}

export async function getFleetDestinations(req: Request, e: Env): Promise<Response> {
  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get('range') || '7d');
  const routeFilter = parseRouteFilter(url.searchParams.get('route'));
  const sort = parseSort(url.searchParams.get('sort'));
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const limit = parseLimit(url.searchParams.get('limit'));
  const from = now() - rangeSeconds(range);

  const conditions = ['day_at >= ?', "etld1 != '__other__'"];
  const binds: unknown[] = [from];
  if (routeFilter) {
    conditions.push('route = ?');
    binds.push(routeFilter);
  }
  if (q) {
    conditions.push("LOWER(etld1) LIKE ? ESCAPE '\\'");
    binds.push(`%${q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
  }
  binds.push(limit);

  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      `SELECT
         etld1,
         route,
         COUNT(DISTINCT user_id) AS users,
         SUM(connections) AS connections,
         SUM(closed_connections) AS closed_connections,
         SUM(stalled_connections) AS stalled_connections,
         SUM(duration_ms_sum) AS duration_ms_sum,
         SUM(bytes_up) AS bytes_up,
         SUM(bytes_down) AS bytes_down,
         GROUP_CONCAT(DISTINCT NULLIF(top_process, '')) AS top_processes,
         GROUP_CONCAT(DISTINCT NULLIF(node, '')) AS nodes,
         MAX(updated_at) AS latest_updated_at
       FROM traffic_destination_daily
       WHERE ${conditions.join(' AND ')}
       GROUP BY etld1, route
       ORDER BY ${SORT_SQL[sort]}
       LIMIT ?`,
    ).bind(...binds).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }

  let updatedAt = 0;
  const items: FleetDestinationDto[] = [];
  for (const row of rows) {
    const routeRaw = String(row.route);
    if (!ROUTE_SET.has(routeRaw)) continue;
    const closed = Number(row.closed_connections) || 0;
    const stalled = Number(row.stalled_connections) || 0;
    const durationSum = Number(row.duration_ms_sum) || 0;
    const rowUpdated = Number(row.latest_updated_at) || 0;
    if (rowUpdated > updatedAt) updatedAt = rowUpdated;
    items.push({
      etld1: String(row.etld1),
      route: routeRaw as RouteKind,
      users: Number(row.users) || 0,
      connections: Number(row.connections) || 0,
      closedConnections: closed,
      stalledConnections: stalled,
      stallRate: closed > 0 ? Math.min(1, Math.round((stalled / closed) * 10_000) / 10_000) : 0,
      avgDurationMs: closed > 0 ? Math.round(durationSum / closed) : 0,
      bytesUp: Number(row.bytes_up) || 0,
      bytesDown: Number(row.bytes_down) || 0,
      topProcesses: splitDistinct(row.top_processes),
      nodes: splitDistinct(row.nodes),
    });
  }

  return listJson(
    e,
    req,
    items,
    null,
    updatedAt || now(),
    weakEtag(['fleet-destinations', range, routeFilter ?? '', sort, q, limit, items.length]),
    assertFleetDestination,
    items.length,
  );
}
