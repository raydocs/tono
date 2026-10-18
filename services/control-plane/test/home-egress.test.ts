import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { egressConsensus, type EgressConnect, type EgressFetch, type GeoAnswer } from '../src/home-egress';
import { homeEgressResource } from '../src/ops/shared-admin/home-egress';

const e = () => env as unknown as Env;
const NOW = 1_800_000_000;
const PASSWORD = 'LoXD0+secret';

async function seedSocksHome(id: string) {
  await e().DB.prepare(
    `INSERT INTO home_exits(id, proxy_name, display_name, kind, socks5_host, socks5_port,
       socks5_username, socks5_password, status, created_at, updated_at)
     VALUES(?, ?, ?, 'socks5', 'isp.example.net', 10078, 'spuser', ?, 'active', ?, ?)`,
  ).bind(id, `proxy-${id}`, `Home ${id}`, PASSWORD, NOW, NOW).run();
}

/**
 * A SOCKS5 server in a stream pair: checks the greeting, the RFC 1929
 * credential and the CONNECT target, then answers the HTTP request with `ip`.
 */
function fakeLine(ip: string, seen: { auth?: string; target?: string }, acceptPassword = PASSWORD): EgressConnect {
  return () => {
    let reply!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({ start: (c) => { reply = c; } });
    let step = 0;
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        if (step === 0) {
          expect([...chunk]).toEqual([5, 1, 2]);
          reply.enqueue(Uint8Array.from([5, 2]));
        } else if (step === 1) {
          const ulen = chunk[1]!;
          const user = new TextDecoder().decode(chunk.slice(2, 2 + ulen));
          const pass = new TextDecoder().decode(chunk.slice(3 + ulen, 3 + ulen + chunk[2 + ulen]!));
          seen.auth = `${user}:${pass}`;
          const ok = pass === acceptPassword;
          reply.enqueue(Uint8Array.from([1, ok ? 0 : 1]));
          if (!ok) reply.close();
        } else if (step === 2) {
          const host = new TextDecoder().decode(chunk.slice(5, 5 + chunk[4]!));
          seen.target = `${host}:${(chunk[5 + chunk[4]!]! << 8) | chunk[6 + chunk[4]!]!}`;
          reply.enqueue(Uint8Array.from([5, 0, 0, 1, 10, 0, 0, 1, 0, 80]));
        } else {
          reply.enqueue(new TextEncoder().encode(`HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\n${ip}\n`));
          reply.close();
        }
        step += 1;
      },
    });
    return { opened: Promise.resolve(), readable, writable, close: () => undefined };
  };
}

const geoFetch = (asked: string[]): EgressFetch => async (url) => {
  asked.push(url);
  if (url.includes('ipinfo.io')) {
    return Response.json({ ip: '48.45.90.215', city: 'New York City', region: 'New York', country: 'US', org: 'AS7922 Comcast' });
  }
  if (url.includes('ip-api.com')) {
    return Response.json({ status: 'success', countryCode: 'US', regionName: 'Texas', city: 'Houston', isp: 'Comcast', as: 'AS7922 Comcast', hosting: false });
  }
  return new Response('busy', { status: 429 });
};

describe('home egress lookup', () => {
  it('dials the line with its stored credential, records the echoed IP and every provider answer, and never returns the password', async () => {
    await seedSocksHome('egress-ok');
    const seen: { auth?: string; target?: string } = {};
    const asked: string[] = [];
    const res = await homeEgressResource(
      new Request('https://hub.test/api/v1/ops/home-exits/egress-ok/egress', { method: 'POST' }),
      e(), 'home-exits/egress-ok/egress', 'POST', 'owner@example.com',
      { connect: fakeLine('48.45.90.215', seen), fetch: geoFetch(asked) },
    );
    const text = await res!.text();
    expect(seen).toEqual({ auth: `spuser:${PASSWORD}`, target: 'api.ipify.org:80' });
    expect(text).not.toContain(PASSWORD);
    const { lookup } = JSON.parse(text) as { lookup: { ip: string; answers: GeoAnswer[]; consensus: { conflict: boolean } } };
    expect(lookup.ip).toBe('48.45.90.215');
    expect(lookup.answers).toHaveLength(9);
    expect(asked.every((url) => url.includes('48.45.90.215'))).toBe(true);
    expect(lookup.answers.filter((answer) => answer.ok).map((answer) => answer.region)).toEqual(['New York', 'Texas']);
    expect(lookup.answers.find((answer) => answer.provider === 'ipapi.co')).toMatchObject({ ok: false, error: 'HTTP 429' });
    expect(lookup.consensus.conflict).toBe(true);
    const home = await e().DB.prepare('SELECT egress_ipv4, updated_at FROM home_exits WHERE id = ?').bind('egress-ok').first();
    expect(home).toEqual({ egress_ipv4: '48.45.90.215', updated_at: NOW });
    const listed = await homeEgressResource(
      new Request('https://hub.test/api/v1/ops/home-exits/egress'), e(), 'home-exits/egress', 'GET', undefined,
    );
    const { lookups } = await listed!.json() as { lookups: Array<{ homeExitId: string; ip: string }> };
    expect(lookups.find((row) => row.homeExitId === 'egress-ok')?.ip).toBe('48.45.90.215');
  });

  it('records a rejected credential as an auth-stage failure and asks no provider', async () => {
    await seedSocksHome('egress-bad');
    const asked: string[] = [];
    const res = await homeEgressResource(
      new Request('https://hub.test/api/v1/ops/home-exits/egress-bad/egress', { method: 'POST' }),
      e(), 'home-exits/egress-bad/egress', 'POST', 'owner@example.com',
      { connect: fakeLine('48.45.90.215', {}, 'other'), fetch: geoFetch(asked) },
    );
    const { lookup } = await res!.json() as { lookup: { ip: string | null; errorStage: string; error: string } };
    expect(lookup).toMatchObject({ ip: null, errorStage: 'auth', error: 'username or password rejected' });
    expect(asked).toEqual([]);
  });

  it('votes on the region and flags a disagreement instead of averaging it away', () => {
    const at = (provider: string, region: string | null, city: string | null): GeoAnswer => ({
      provider, ok: true, country: 'US', region, city, org: null, asn: null, hosting: null, error: null, ms: 1,
    });
    expect(egressConsensus([
      at('a', 'Texas', 'Houston'), at('b', 'texas', 'Houston (Mid West)'), at('c', 'New York', 'New York City'),
      at('d', null, null), at('e', 'Texas', 'Houston'),
    ])).toEqual({ region: 'Texas', city: 'Houston', country: 'US', votes: 3, of: 4, conflict: true });
  });
});
