import { connect as socketConnect } from 'cloudflare:sockets';
import { ApiError } from '../../errors';
import { type Env, type Row, now } from '../../env';
import {
  EgressError,
  egressConsensus,
  geolocate,
  isIpv4,
  resolveEgressIp,
  type EgressConnect,
  type EgressFetch,
  type GeoAnswer,
} from '../../home-egress';
import { writeOpsAudit } from '../../product-account';

export type HomeEgressDeps = { connect: EgressConnect; fetch: EgressFetch };

const LIVE: HomeEgressDeps = {
  connect: socketConnect,
  fetch: (url, init) => fetch(url, init),
};

function answersOf(row: Row): GeoAnswer[] {
  try {
    const parsed: unknown = JSON.parse(String(row.answers ?? '[]'));
    return Array.isArray(parsed) ? parsed as GeoAnswer[] : [];
  } catch {
    return [];
  }
}

function publicLookup(row: Row) {
  const answers = answersOf(row);
  return {
    homeExitId: String(row.home_exit_id),
    ip: row.ip == null ? null : String(row.ip),
    checkedAt: Number(row.checked_at),
    errorStage: row.error_stage == null ? null : String(row.error_stage),
    error: row.error == null ? null : String(row.error),
    answers,
    consensus: egressConsensus(answers),
  };
}

/**
 * `GET home-exits/egress` — the latest lookup of every line still in stock.
 * `POST home-exits/{id}/egress` — dial the line now and replace its lookup.
 *
 * The POST reads the SOCKS5 password from D1 and hands it only to the tunnel:
 * no response, error text or audit row carries it. A tunnel that fails is a
 * recorded lookup with its stage, not an API error, so the table can say which
 * line is dead and why. A catalog line has no tunnel; its stored address is
 * geolocated as it stands.
 */
export async function homeEgressResource(
  _req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
  deps: HomeEgressDeps = LIVE,
): Promise<Response | null> {
  if (resource === 'home-exits/egress' && m === 'GET') {
    const q = await e.DB.prepare(
      `SELECT home_exit_egress.* FROM home_exit_egress
       JOIN home_exits ON home_exits.id = home_exit_egress.home_exit_id
       ORDER BY home_exit_egress.checked_at DESC`,
    ).all<Row>();
    return Response.json({ lookups: q.results.map(publicLookup) });
  }
  const mt = resource.match(/^home-exits\/([^/]+)\/egress$/);
  if (!mt || m !== 'POST') return null;
  const homeId = mt[1]!;
  const home = await e.DB.prepare('SELECT * FROM home_exits WHERE id = ?').bind(homeId).first<Row>();
  if (!home) throw new ApiError(404, 'NOT_FOUND', 'Home exit not found');

  let ip: string | null = null;
  let errorStage: string | null = null;
  let error: string | null = null;
  if (String(home.kind) === 'socks5' && home.socks5_host != null && home.socks5_port != null) {
    try {
      ip = await resolveEgressIp({
        host: String(home.socks5_host),
        port: Number(home.socks5_port),
        username: home.socks5_username == null ? null : String(home.socks5_username),
        password: home.socks5_password == null ? null : String(home.socks5_password),
      }, deps.connect);
    } catch (x) {
      errorStage = x instanceof EgressError ? x.stage : 'connect';
      error = x instanceof Error ? x.message : 'lookup failed';
    }
  } else if (home.egress_ipv4 != null) {
    ip = String(home.egress_ipv4);
  } else {
    throw new ApiError(409, 'HOME_EGRESS_UNKNOWN', 'A catalog line needs a stored egress address to look up');
  }

  const answers = ip === null ? [] : await geolocate(ip, deps.fetch);
  const t = now();
  const writes = [
    e.DB.prepare(
      `INSERT INTO home_exit_egress(home_exit_id, ip, checked_at, error_stage, error, answers)
       VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(home_exit_id) DO UPDATE SET
         ip = excluded.ip, checked_at = excluded.checked_at, error_stage = excluded.error_stage,
         error = excluded.error, answers = excluded.answers`,
    ).bind(homeId, ip, t, errorStage, error, JSON.stringify(answers)),
  ];
  // The stored address is display-only (no catalog reads it), so following
  // what the line really exits from needs no catalog revision. updated_at
  // stays put, as for the prober: this is an observation, not an edit.
  if (ip !== null && isIpv4(ip) && ip !== (home.egress_ipv4 == null ? null : String(home.egress_ipv4))) {
    writes.push(e.DB.prepare(
      'UPDATE home_exits SET egress_ipv4 = ?, updated_at = updated_at WHERE id = ?',
    ).bind(ip, homeId));
  }
  await e.DB.batch(writes);
  await writeOpsAudit(
    e, actorEmail, 'home.egress', 'home_exit', homeId,
    ip === null ? `egress lookup failed at ${errorStage}` : `egress ${ip}`,
  );
  const row = await e.DB.prepare('SELECT * FROM home_exit_egress WHERE home_exit_id = ?').bind(homeId).first<Row>();
  return Response.json({ lookup: publicLookup(row!) });
}
