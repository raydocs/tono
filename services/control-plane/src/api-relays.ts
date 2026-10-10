import { connect as socketConnect } from 'cloudflare:sockets';

// Tono-owned API relays (decision 077): nginx `stream` + `ssl_preread` on an
// exit node, admitting only the API and release SNIs and forwarding the
// unterminated TLS to the Cloudflare edge. Clients try them when every direct
// Cloudflare path is dead.
//
// Keep in step with the clients' compiled lists:
// `apps/windows/app/src-tauri/src/tono/bootstrap.rs` `API_RELAYS` and
// `apps/macos/Tono/Services/ControlPlanePath.swift` `apiRelays`.
export const API_RELAYS: readonly ApiRelay[] = [
  { name: 'Los Angeles · Westwood', host: '179.253.233.220', port: 2053 },
  { name: 'Los Angeles · Mesa', host: '179.255.154.17', port: 2053 },
];

export type ApiRelay = { name: string; host: string; port: number };

/** The slice of a `cloudflare:sockets` socket the probe uses, so tests can stand in for it. */
export type RelaySocket = { opened: Promise<unknown>; close: () => Promise<unknown> | unknown };
export type RelayConnect = (address: { hostname: string; port: number }) => RelaySocket;

/** Wall-clock budget per relay; the relays are probed in parallel. */
export const RELAY_PROBE_TIMEOUT_MS = 5_000;
const ERROR_MAX = 200;

/** The `api_relay_probes` key: what the relay is, not what it is called. */
export const relayKey = (relay: ApiRelay) => `${relay.host}:${relay.port}`;

type ProbeResult = { ok: boolean; latencyMs: number | null; error: string | null };

async function probeOne(relay: ApiRelay, connect: RelayConnect, timeoutMs: number): Promise<ProbeResult> {
  const started = Date.now();
  let socket: RelaySocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    socket = connect({ hostname: relay.host, port: relay.port });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    await Promise.race([socket.opened, timeout]);
    return { ok: true, latencyMs: Math.max(0, Date.now() - started), error: null };
  } catch (x) {
    const reason = x instanceof Error ? x.message : String(x);
    return { ok: false, latencyMs: null, error: `tcp connect: ${reason}`.slice(0, ERROR_MAX) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Never wait on the close: a socket that never opened may never settle it.
    if (socket) {
      try {
        void Promise.resolve(socket.close()).catch(() => undefined);
      } catch {
        // Already closed or never opened.
      }
    }
  }
}

/**
 * One cron tick: open a plain TCP connection to each relay and close it.
 *
 * TLS cannot be checked from a Worker (a raw socket cannot set the SNI the
 * relay admits on), so an open port is the check; `error` says `tcp connect`
 * so nobody reads it as a TLS verdict. `ok_since` / `failing_since` keep the
 * start of the current run of successes or failures. Bounded: the relays are
 * probed in parallel, each cut at `timeoutMs`, and a probe failure is a row,
 * never a throw.
 */
export async function probeApiRelays(
  db: D1Database,
  t: number,
  connect: RelayConnect = socketConnect,
  relays: readonly ApiRelay[] = API_RELAYS,
  timeoutMs = RELAY_PROBE_TIMEOUT_MS,
): Promise<void> {
  if (relays.length === 0) return;
  const results = await Promise.all(relays.map(async (relay) => ({
    relay, r: await probeOne(relay, connect, timeoutMs),
  })));
  await db.batch(results.map(({ relay, r }) => {
    const ok = r.ok ? 1 : 0;
    return db.prepare(
      `INSERT INTO api_relay_probes(relay, checked_at, ok, latency_ms, error, ok_since, failing_since)
       VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(relay) DO UPDATE SET
         checked_at = excluded.checked_at,
         ok = excluded.ok,
         latency_ms = excluded.latency_ms,
         error = excluded.error,
         ok_since = CASE WHEN excluded.ok = 1
           THEN COALESCE(CASE WHEN api_relay_probes.ok = 1 THEN api_relay_probes.ok_since END, excluded.checked_at)
           END,
         failing_since = CASE WHEN excluded.ok = 0
           THEN COALESCE(CASE WHEN api_relay_probes.ok = 0 THEN api_relay_probes.failing_since END, excluded.checked_at)
           END`,
    ).bind(relayKey(relay), t, ok, r.latencyMs, r.error, r.ok ? t : null, r.ok ? null : t);
  }));
}
