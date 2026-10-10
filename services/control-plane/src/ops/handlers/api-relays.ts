import type { Env, Row } from '../../env';
import { API_RELAYS, relayKey } from '../../api-relays';
import { assertApiRelays, type ApiRelaysDto } from '../contract';
import { entityJson, missingTable, nullInt, nullText, weakEtag } from './common';

/**
 * `GET /api/v1/ops/api-relays`: every relay the clients have compiled in, with
 * the cron's last TCP check of it. A relay the cron has not reached yet (or a
 * database the migration has not reached) reads as all-null, never as down.
 */
export async function getApiRelays(req: Request, e: Env): Promise<Response> {
  let rows: Row[] = [];
  try {
    rows = (await e.DB.prepare(
      'SELECT relay, checked_at, ok, latency_ms, error, ok_since, failing_since FROM api_relay_probes',
    ).all<Row>()).results ?? [];
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const byKey = new Map(rows.map((row) => [String(row.relay), row]));
  const body: ApiRelaysDto = {
    relays: API_RELAYS.map((relay) => {
      const row = byKey.get(relayKey(relay));
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
      };
    }),
  };
  const etag = weakEtag(body.relays.map((relay) => `${relay.host}:${relay.port}:${relay.checkedAt ?? 0}`));
  return entityJson(e, req, body, etag, assertApiRelays);
}
