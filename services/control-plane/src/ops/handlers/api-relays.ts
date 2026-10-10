import type { Env, Row } from '../../env';
import { API_RELAYS, relayKey } from '../../api-relays';
import { assertApiRelays, type ApiRelayEndToEndDto, type ApiRelaysDto } from '../contract';
import { entityJson, missingTable, nullInt, nullText, weakEtag } from './common';

async function rowsOf(e: Env, sql: string): Promise<Map<string, Row>> {
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(sql).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  return new Map(rows.map((row) => [String(row.relay), row]));
}

function endToEndOf(row: Row | undefined): { endToEnd?: ApiRelayEndToEndDto } {
  if (!row) return {};
  return {
    endToEnd: {
      ok: Number(row.ok) === 1,
      observedAt: Number(row.observed_at),
      httpStatus: nullInt(row.http_status),
      latencyMs: nullInt(row.latency_ms),
      error: nullText(row.error),
      okSince: nullInt(row.ok_since),
      failingSince: nullInt(row.failing_since),
    },
  };
}

/**
 * `GET /api/v1/ops/api-relays`: every relay the clients have compiled in, with
 * the cron's last TCP check of it and, once the relay node has reported, its
 * own end-to-end HTTPS check. A relay nobody has checked yet (or a database the
 * migration has not reached) reads as all-null / absent, never as down.
 */
export async function getApiRelays(req: Request, e: Env): Promise<Response> {
  const probes = await rowsOf(
    e,
    'SELECT relay, checked_at, ok, latency_ms, error, ok_since, failing_since FROM api_relay_probes',
  );
  const reports = await rowsOf(
    e,
    `SELECT relay, observed_at, ok, http_status, latency_ms, error, ok_since, failing_since
     FROM api_relay_reports`,
  );
  const body: ApiRelaysDto = {
    relays: API_RELAYS.map((relay) => {
      const row = probes.get(relayKey(relay));
      return {
        name: relay.name,
        host: relay.host,
        port: relay.port,
        ok: row ? Number(row.ok) === 1 : null,
        checkedAt: nullInt(row?.checked_at),
        latencyMs: nullInt(row?.latency_ms),
        error: nullText(row?.error),
        okSince: nullInt(row?.ok_since),
        failingSince: nullInt(row?.failing_since),
        ...endToEndOf(reports.get(relayKey(relay))),
      };
    }),
  };
  const etag = weakEtag(body.relays.map((relay) => (
    `${relay.host}:${relay.port}:${relay.checkedAt ?? 0}:${relay.endToEnd?.observedAt ?? 0}`
  )));
  return entityJson(e, req, body, etag, assertApiRelays);
}
