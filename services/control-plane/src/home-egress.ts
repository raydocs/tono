import { connect as socketConnect } from 'cloudflare:sockets';

// Where a residential line really comes out, and where the world thinks that is.
//
// The stored `egress_ipv4` was typed by hand, and the geolocation databases do
// not agree with each other about decodo's ISP ranges (one says New York, two
// say Houston for the same 48.45.x address). So the Worker dials the line
// itself — SOCKS5 over a raw socket, with the credential that never leaves the
// hub — asks a plain-HTTP echo which address it sees, then asks every keyless
// geolocation service about that address and keeps each answer side by side.
// A disagreement is the finding; nothing here averages it away.

/** The slice of a `cloudflare:sockets` socket the lookup uses, so tests can stand in for it. */
export type EgressSocket = {
  opened: Promise<unknown>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close: () => Promise<void> | void;
};
export type EgressConnect = (address: { hostname: string; port: number }) => EgressSocket;
export type EgressFetch = (url: string, init: RequestInit) => Promise<Response>;

export type Socks5Line = { host: string; port: number; username: string | null; password: string | null };

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
  ms: number;
};

export type EgressConsensus = {
  region: string | null;
  city: string | null;
  country: string | null;
  /** Answers naming the majority region, out of the answers naming any region. */
  votes: number;
  of: number;
  conflict: boolean;
};

/** Stage of the tunnel that failed; the operator needs to know which, never the credential. */
export class EgressError extends Error {
  constructor(readonly stage: 'connect' | 'auth' | 'tunnel' | 'echo' | 'timeout', message: string) {
    super(message);
  }
}

export const TUNNEL_TIMEOUT_MS = 10_000;
export const PROVIDER_TIMEOUT_MS = 6_000;
const ECHO_LIMIT = 4096;
const ERROR_MAX = 160;

/** Plain HTTP on port 80: a raw socket through the tunnel has no TLS of its own. */
const ECHOES = [
  { hostname: 'api.ipify.org', path: '/' },
  { hostname: 'checkip.amazonaws.com', path: '/' },
] as const;

const SOCKS_REPLY: Record<number, string> = {
  1: 'general failure',
  2: 'not allowed by ruleset',
  3: 'network unreachable',
  4: 'host unreachable',
  5: 'connection refused',
  6: 'TTL expired',
  7: 'command not supported',
  8: 'address type not supported',
};

class ByteReader {
  private buffered = new Uint8Array(0);
  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async take(n: number, stage: EgressError['stage']): Promise<Uint8Array> {
    while (this.buffered.length < n) {
      const { value, done } = await this.reader.read();
      if (done) throw new EgressError(stage, 'connection closed by the line');
      this.append(value);
    }
    const out = this.buffered.slice(0, n);
    this.buffered = this.buffered.slice(n);
    return out;
  }

  /** Everything until the far end closes, cut at `limit` bytes. */
  async rest(limit: number): Promise<Uint8Array> {
    while (this.buffered.length < limit) {
      const { value, done } = await this.reader.read();
      if (done) break;
      this.append(value);
    }
    return this.buffered.slice(0, limit);
  }

  private append(chunk: Uint8Array) {
    const next = new Uint8Array(this.buffered.length + chunk.length);
    next.set(this.buffered);
    next.set(chunk, this.buffered.length);
    this.buffered = next;
  }
}

const encoder = new TextEncoder();

/** RFC 1928 + RFC 1929: greet, authenticate, CONNECT by domain name. */
async function socks5Connect(
  reader: ByteReader,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  line: Socks5Line,
  target: { hostname: string; port: number },
) {
  const withAuth = line.username !== null && line.password !== null;
  await writer.write(Uint8Array.from(withAuth ? [5, 1, 2] : [5, 1, 0]));
  const [version, method] = await reader.take(2, 'auth');
  if (version !== 5) throw new EgressError('auth', 'not a SOCKS5 server');
  if (method === 0xff) throw new EgressError('auth', 'no acceptable authentication method');
  if (method === 2) {
    if (!withAuth) throw new EgressError('auth', 'line asks for a password that is not stored');
    const user = encoder.encode(line.username!);
    const pass = encoder.encode(line.password!);
    if (user.length > 255 || pass.length > 255) throw new EgressError('auth', 'credential too long for SOCKS5');
    await writer.write(Uint8Array.from([1, user.length, ...user, pass.length, ...pass]));
    const [, status] = await reader.take(2, 'auth');
    if (status !== 0) throw new EgressError('auth', 'username or password rejected');
  } else if (method !== 0) {
    throw new EgressError('auth', `unsupported method ${method}`);
  }
  const host = encoder.encode(target.hostname);
  await writer.write(Uint8Array.from([5, 1, 0, 3, host.length, ...host, target.port >> 8, target.port & 0xff]));
  const head = await reader.take(4, 'tunnel');
  if (head[1] !== 0) throw new EgressError('tunnel', SOCKS_REPLY[head[1]!] ?? `reply ${head[1]}`);
  const atyp = head[3];
  const addressBytes = atyp === 1 ? 4 : atyp === 4 ? 16 : atyp === 3 ? (await reader.take(1, 'tunnel'))[0]! : -1;
  if (addressBytes < 0) throw new EgressError('tunnel', 'malformed reply');
  await reader.take(addressBytes + 2, 'tunnel');
}

export function isIpAddress(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split('.').every((part) => Number(part) <= 255);
  return /^[0-9a-f:]+$/i.test(value) && value.includes(':') && value.length <= 45;
}

export function isIpv4(value: string): boolean {
  return value.includes('.') && isIpAddress(value);
}

/** HTTP/1.0 so the echo cannot answer chunked; the body is one address. */
function parseEcho(raw: Uint8Array): string {
  const text = new TextDecoder().decode(raw);
  const split = text.indexOf('\r\n\r\n');
  const status = text.slice(0, text.indexOf('\r\n'));
  if (split < 0 || !/^HTTP\/1\.[01] 200\b/.test(status)) {
    throw new EgressError('echo', `echo answered ${status.slice(0, 40) || 'nothing'}`);
  }
  const ip = text.slice(split + 4).trim();
  if (!isIpAddress(ip)) throw new EgressError('echo', 'echo did not answer an address');
  return ip;
}

async function echoThrough(
  line: Socks5Line,
  echo: (typeof ECHOES)[number],
  connect: EgressConnect,
): Promise<string> {
  let socket: EgressSocket;
  try {
    socket = connect({ hostname: line.host, port: line.port });
  } catch (x) {
    throw new EgressError('connect', x instanceof Error ? x.message : String(x));
  }
  try {
    try {
      await socket.opened;
    } catch (x) {
      throw new EgressError('connect', x instanceof Error ? x.message : String(x));
    }
    const writer = socket.writable.getWriter();
    const reader = new ByteReader(socket.readable.getReader());
    await socks5Connect(reader, writer, line, { hostname: echo.hostname, port: 80 });
    await writer.write(encoder.encode(
      `GET ${echo.path} HTTP/1.0\r\nHost: ${echo.hostname}\r\nUser-Agent: tono-ops\r\nAccept: text/plain\r\n\r\n`,
    ));
    return parseEcho(await reader.rest(ECHO_LIMIT));
  } finally {
    // Never wait on the close: a socket that never opened may never settle it.
    try {
      void Promise.resolve(socket.close()).catch(() => undefined);
    } catch {
      // Already closed.
    }
  }
}

/**
 * The address the line exits from, as an echo on the far side sees it. The
 * second echo is tried only when the first fails for a reason past the SOCKS5
 * handshake: a rejected password will not be any better on another host.
 */
export async function resolveEgressIp(
  line: Socks5Line,
  connect: EgressConnect = socketConnect,
  timeoutMs = TUNNEL_TIMEOUT_MS,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EgressError('timeout', `no answer in ${timeoutMs} ms`)), timeoutMs);
  });
  // A line that stalls mid-handshake would otherwise hold its socket until the
  // request ends: on timeout every socket opened here is closed, not waited on.
  const opened: EgressSocket[] = [];
  const tracked: EgressConnect = (address) => {
    const socket = connect(address);
    opened.push(socket);
    return socket;
  };
  try {
    return await Promise.race([(async () => {
      let last: unknown;
      for (const echo of ECHOES) {
        try {
          return await echoThrough(line, echo, tracked);
        } catch (x) {
          last = x;
          if (x instanceof EgressError && x.stage !== 'echo') throw x;
        }
      }
      throw last;
    })(), timeout]);
  } catch (x) {
    if (x instanceof EgressError) throw new EgressError(x.stage, x.message.slice(0, ERROR_MAX));
    throw new EgressError('connect', String(x).slice(0, ERROR_MAX));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    for (const socket of opened) {
      try {
        void Promise.resolve(socket.close()).catch(() => undefined);
      } catch {
        // Already closed.
      }
    }
  }
}

type Json = Record<string, unknown>;
type Fix = Omit<GeoAnswer, 'provider' | 'ok' | 'error' | 'ms'>;

const s = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const o = (value: unknown): Json => (value !== null && typeof value === 'object' ? value as Json : {});
const b = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
function asn(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  const m = typeof value === 'string' ? /^(?:AS)?(\d+)\b/i.exec(value.trim()) : null;
  return m ? Number(m[1]) : null;
}
/** "AS7922 Comcast Cable Communications, LLC" → the name without the number. */
function orgName(value: unknown): string | null {
  const text = s(value);
  return text === null ? null : s(text.replace(/^AS\d+\s*/i, ''));
}

type Provider = { id: string; url: (ip: string) => string; parse: (j: Json) => Fix | string };

/** Every one keyless; a provider that wants a key or a sign-up is not here. */
export const GEO_PROVIDERS: readonly Provider[] = [
  {
    id: 'ipinfo',
    url: (ip) => `https://ipinfo.io/${ip}/json`,
    parse: (j) => (j.bogon === true ? 'bogon address' : s(o(j.error).message) ?? {
      country: s(j.country), region: s(j.region), city: s(j.city),
      org: orgName(j.org), asn: asn(j.org), hosting: null,
    }),
  },
  {
    id: 'ip-api',
    url: (ip) => `http://ip-api.com/json/${ip}?fields=status,message,countryCode,regionName,city,isp,as,hosting`,
    parse: (j) => (j.status !== 'success' ? s(j.message) ?? 'failed' : {
      country: s(j.countryCode), region: s(j.regionName), city: s(j.city),
      org: s(j.isp), asn: asn(j.as), hosting: b(j.hosting),
    }),
  },
  {
    id: 'ipwho.is',
    url: (ip) => `https://ipwho.is/${ip}`,
    parse: (j) => (j.success === false ? s(j.message) ?? 'failed' : {
      country: s(j.country_code), region: s(j.region), city: s(j.city),
      org: s(o(j.connection).isp), asn: asn(o(j.connection).asn), hosting: null,
    }),
  },
  {
    id: 'ipapi.is',
    url: (ip) => `https://api.ipapi.is/?q=${ip}`,
    parse: (j) => {
      if (s(j.error)) return s(j.error)!;
      const at = o(j.location);
      const net = o(j.asn);
      return {
        country: s(at.country_code) ?? s(j.country), region: s(at.state) ?? s(j.region), city: s(at.city) ?? s(j.city),
        org: s(net.org) ?? orgName(j.asn), asn: asn(net.asn) ?? asn(j.asn), hosting: b(j.is_datacenter),
      };
    },
  },
  {
    id: 'ipapi.co',
    url: (ip) => `https://ipapi.co/${ip}/json/`,
    parse: (j) => (j.error === true ? s(j.reason) ?? 'failed' : {
      country: s(j.country_code), region: s(j.region), city: s(j.city),
      org: s(j.org), asn: asn(j.asn), hosting: null,
    }),
  },
  {
    id: 'freeipapi',
    url: (ip) => `https://free.freeipapi.com/api/v1/json/${ip}`,
    parse: (j) => (s(j.message) && !s(j.countryCode) ? s(j.message)! : {
      country: s(j.countryCode), region: s(j.regionName), city: s(j.cityName),
      org: s(j.asnOrganization), asn: asn(j.asn), hosting: null,
    }),
  },
  {
    id: 'geojs',
    url: (ip) => `https://get.geojs.io/v1/ip/geo/${ip}.json`,
    parse: (j) => ({
      country: s(j.country_code), region: s(j.region), city: s(j.city),
      org: s(j.organization_name), asn: asn(j.asn), hosting: null,
    }),
  },
  {
    id: 'db-ip',
    url: (ip) => `https://api.db-ip.com/v2/free/${ip}`,
    parse: (j) => s(j.error) ?? {
      country: s(j.countryCode), region: s(j.stateProv), city: s(j.city),
      org: null, asn: null, hosting: null,
    },
  },
  {
    id: 'country.is',
    url: (ip) => `https://api.country.is/${ip}?fields=city,subdivision,asn`,
    parse: (j) => s(j.error) ?? {
      country: s(j.country), region: s(j.subdivision), city: s(j.city),
      org: s(o(j.asn).organization), asn: asn(o(j.asn).number), hosting: null,
    },
  },
];

const FAILED: Fix = { country: null, region: null, city: null, org: null, asn: null, hosting: null };

async function askProvider(provider: Provider, ip: string, fetcher: EgressFetch, timeoutMs: number): Promise<GeoAnswer> {
  const started = Date.now();
  const failed = (error: string): GeoAnswer => ({
    provider: provider.id, ok: false, ...FAILED, error: error.slice(0, ERROR_MAX), ms: Date.now() - started,
  });
  try {
    const response = await fetcher(provider.url(ip), {
      headers: { accept: 'application/json', 'user-agent': 'tono-ops/1' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) return failed(`HTTP ${response.status}`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return failed('not JSON');
    }
    const fix = provider.parse(o(json));
    if (typeof fix === 'string') return failed(fix);
    return { provider: provider.id, ok: true, ...fix, error: null, ms: Date.now() - started };
  } catch (x) {
    const name = x instanceof Error ? x.name : '';
    return failed(name === 'TimeoutError' || name === 'AbortError' ? `no answer in ${timeoutMs} ms` : String(x));
  }
}

/** All providers in parallel; a provider that fails is an answer saying so, never a throw. */
export function geolocate(
  ip: string,
  fetcher: EgressFetch = (url, init) => fetch(url, init),
  providers: readonly Provider[] = GEO_PROVIDERS,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<GeoAnswer[]> {
  return Promise.all(providers.map((provider) => askProvider(provider, ip, fetcher, timeoutMs)));
}

function mostCommon(values: readonly string[]): { value: string | null; votes: number } {
  const tally = new Map<string, { value: string; votes: number }>();
  for (const value of values) {
    const key = value.toLowerCase();
    const entry = tally.get(key) ?? { value, votes: 0 };
    entry.votes += 1;
    tally.set(key, entry);
  }
  let best: { value: string; votes: number } | null = null;
  for (const entry of tally.values()) if (best === null || entry.votes > best.votes) best = entry;
  return { value: best?.value ?? null, votes: best?.votes ?? 0 };
}

/**
 * The region most answers name, and whether any answer names another. Cities
 * are spelled differently by every database ("Houston" / "Houston (Mid West)"),
 * so the vote is on the region; the city is the commonest among those voters.
 */
export function egressConsensus(answers: readonly GeoAnswer[]): EgressConsensus {
  const located = answers.filter((answer) => answer.ok && answer.region !== null);
  const regions = located.map((answer) => answer.region!);
  const region = mostCommon(regions);
  const voters = located.filter((answer) => answer.region!.toLowerCase() === region.value?.toLowerCase());
  const city = mostCommon(voters.flatMap((answer) => (answer.city === null ? [] : [answer.city])));
  const country = mostCommon(answers.flatMap((answer) => (
    answer.ok && answer.country !== null && answer.country.length === 2 ? [answer.country.toUpperCase()] : []
  )));
  return {
    region: region.value,
    city: city.value,
    country: country.value,
    votes: region.votes,
    of: regions.length,
    conflict: new Set(regions.map((value) => value.toLowerCase())).size > 1,
  };
}
