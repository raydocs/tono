import { count, list, record, send, text } from './settings-legacy';

/**
 * Where a 家宽 line really exits, from the hub's `home-exits/egress` lookups.
 *
 * The hub dials the line through its own SOCKS5 credential, so the address
 * here is the one the far side sees, not the one somebody typed. Each keyless
 * geolocation service's answer is kept as it came: the databases disagree
 * about ISP ranges (New York against Houston for the same address), and the
 * disagreement is what the operator needs to see before handing a line out.
 */

export type GeoAnswer = {
  provider: string;
  ok: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  org: string | null;
  asn: number | null;
  hosting: boolean | null;
  error: string | null;
  ms: number | null;
};

export type EgressConsensus = {
  region: string | null;
  city: string | null;
  country: string | null;
  votes: number;
  of: number;
  conflict: boolean;
};

export type EgressLookup = {
  homeExitId: string;
  ip: string | null;
  checkedAt: number;
  errorStage: string | null;
  error: string | null;
  answers: GeoAnswer[];
  consensus: EgressConsensus;
};

const maybeText = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const maybeCount = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

function readAnswer(value: unknown): GeoAnswer {
  const row = record(value);
  return {
    provider: text(row.provider),
    ok: row.ok === true,
    country: maybeText(row.country),
    region: maybeText(row.region),
    city: maybeText(row.city),
    org: maybeText(row.org),
    asn: maybeCount(row.asn),
    hosting: typeof row.hosting === 'boolean' ? row.hosting : null,
    error: maybeText(row.error),
    ms: maybeCount(row.ms),
  };
}

function readConsensus(value: unknown): EgressConsensus {
  const row = record(value);
  return {
    region: maybeText(row.region),
    city: maybeText(row.city),
    country: maybeText(row.country),
    votes: maybeCount(row.votes) ?? 0,
    of: maybeCount(row.of) ?? 0,
    conflict: row.conflict === true,
  };
}

export function readLookup(value: unknown): EgressLookup {
  const row = record(value);
  return {
    homeExitId: text(row.homeExitId),
    ip: maybeText(row.ip),
    checkedAt: count(row.checkedAt),
    errorStage: maybeText(row.errorStage),
    error: maybeText(row.error),
    answers: list(row.answers).map(readAnswer),
    consensus: readConsensus(row.consensus),
  };
}

export const egressApi = {
  lookups: (signal?: AbortSignal) =>
    send('GET', 'home-exits/egress', undefined, (value) => list(record(value).lookups).map(readLookup), signal),
  lookUp: (homeExitId: string) =>
    send(
      'POST',
      `home-exits/${encodeURIComponent(homeExitId)}/egress`,
      undefined,
      (value) => readLookup(record(value).lookup),
    ),
};

/** "Houston, Texas", "Texas", or null when nobody placed it. */
export function placeWord(consensus: EgressConsensus): string | null {
  const parts = [consensus.city, consensus.region].filter((part): part is string => part !== null);
  if (parts.length === 0) return consensus.country;
  return parts.join(', ');
}
