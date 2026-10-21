/**
 * Fixture twin of `shared-admin/home-egress.ts`: `GET home-exits/egress` and
 * `POST home-exits/{id}/egress`. No tunnel is dialled; a lookup is made up from
 * the line's stored address so the table and the drawer have something to draw.
 * An odd last octet gets two databases that disagree, so the conflict state is
 * on screen without a special fixture; ipapi.co always answers 429, as the real
 * free tier often does.
 */

type Line = { id: string; kind: string; egressIpv4?: string; socks5Host?: string };

const PROVIDERS = [
  'ipinfo', 'ip-api', 'ipwho.is', 'ipapi.is', 'ipapi.co', 'freeipapi', 'geojs', 'db-ip', 'country.is',
] as const;

const lookups = new WeakMap<object, Map<string, unknown>>();

function storeLookups(store: object): Map<string, unknown> {
  let map = lookups.get(store);
  if (map === undefined) {
    map = new Map();
    lookups.set(store, map);
  }
  return map;
}

export function egressList(store: object): unknown[] {
  return [...storeLookups(store).values()];
}

/** The lookup for one line, or null for a catalog line with no address to look up. */
export function egressLookUp(store: object, line: Line, at: number): unknown {
  const fallback = `198.51.100.${String((line.id.length * 7) % 250 + 1)}`;
  const ip = line.egressIpv4 ?? (line.socks5Host === undefined ? null : fallback);
  if (ip === null) return null;
  const split = Number(ip.split('.').pop()) % 2 === 1;
  const answers = PROVIDERS.map((provider, index) => {
    if (provider === 'ipapi.co') {
      return { provider, ok: false, country: null, region: null, city: null, org: null, asn: null, hosting: null, error: 'HTTP 429', ms: 210 };
    }
    const elsewhere = split && (provider === 'ip-api' || provider === 'ipwho.is');
    return {
      provider,
      ok: true,
      country: 'US',
      region: provider === 'geojs' ? null : elsewhere ? 'Texas' : 'New York',
      city: provider === 'geojs' || provider === 'country.is' ? null : elsewhere ? 'Houston' : 'New York',
      org: provider === 'db-ip' ? null : 'AT&T Enterprises, LLC',
      asn: provider === 'db-ip' ? null : 7018,
      hosting: provider === 'ip-api' ? false : null,
      error: null,
      ms: 120 + index * 35,
    };
  });
  const located = answers.filter((answer) => answer.ok && answer.region !== null);
  const votes = located.filter((answer) => answer.region === 'New York').length;
  const lookup = {
    homeExitId: line.id,
    ip,
    checkedAt: at,
    errorStage: null,
    error: null,
    answers,
    consensus: {
      region: 'New York', city: 'New York', country: 'US', votes, of: located.length, conflict: split,
    },
  };
  storeLookups(store).set(line.id, lookup);
  return lookup;
}
