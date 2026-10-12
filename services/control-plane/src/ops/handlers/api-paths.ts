import { type Env, now } from '../../env';
import { loadApiPaths } from '../../api-paths';
import { assertApiPaths, type ApiPathsDto } from '../contract';
import { entityJson, missingTable, weakEtag } from './common';

/**
 * `GET /api/v1/ops/api-paths`: the last seven UTC days of control-plane
 * arrivals per client ASN and `X-Tono-Path`, with the success rate reported by
 * clients that send `X-Tono-Path-Failed` (decision 080). A database the
 * migration has not reached reads as no rows.
 */
export async function getApiPaths(req: Request, e: Env): Promise<Response> {
  const t = now();
  let body: ApiPathsDto;
  try {
    body = await loadApiPaths(e.DB, t);
  } catch (error) {
    if (!missingTable(error)) throw error;
    body = { since: t - (t % 86_400) - 6 * 86_400, days: 7, rows: [] };
  }
  const etag = weakEtag([
    String(body.since),
    ...body.rows.map((row) => `${row.asn ?? 0}:${row.path}:${row.arrived}:${row.ok}:${row.fail}`),
  ]);
  return entityJson(e, req, body, etag, assertApiPaths);
}
