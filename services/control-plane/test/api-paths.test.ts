import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { loadApiPaths } from '../src/api-paths';
import { recordClient } from '../src/client-identity';
import type { Env } from '../src/env';
import { resetKnownExitAsnsCache } from '../src/ops/exit-asns';

const db = () => (env as unknown as Env).DB;
const DAY = 86_400;

it('folds seven days of stamped arrivals per ASN and path; relay and exit ASNs are unknown, non-reporters have no rate', async () => {
  const t = Math.floor(Date.now() / 1000);
  const today = t - (t % DAY);
  // One device per account, so no device cap gets in the way.
  for (const id of ['old', 'rep', 'relay', 'exit']) {
    await db().prepare(
      `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
       VALUES(?, ?, 'x', 'x', 'active', 0, ?, ?)`,
    ).bind(`u-${id}`, `${id}@example.com`, t, t).run();
    await db().prepare(
      `INSERT INTO devices(id, user_id, installation_id, name, status, created_at, updated_at)
       VALUES(?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(`d-${id}`, `u-${id}`, `inst-${id}`, id, t, t).run();
  }
  await db().prepare(
    `INSERT INTO ops_exit_asns(asn, as_org, node_hint, source, first_seen_at, last_seen_at)
     VALUES(64500, 'Exit Host', NULL, 'exit-agent', ?, ?)`,
  ).bind(t, t).run();
  resetKnownExitAsnsCache();
  // One day outside the window, one inside it.
  await db().prepare(
    `INSERT INTO ops_api_path_daily(day_at, asn, path, as_org, arrived, ok, fail, updated_at)
     VALUES(?, 4134, 'doh', 'China Telecom', 50, 50, 0, ?), (?, 4134, 'system_dns', 'China Telecom', 2, 0, 0, ?)`,
  ).bind(today - 7 * DAY, today - 7 * DAY, today - 6 * DAY, today - 6 * DAY).run();

  const call = (device: string, path: string, asn: number, failed?: string) => {
    const headers: Record<string, string> = { 'x-tono-path': path };
    if (failed !== undefined) headers['x-tono-path-failed'] = failed;
    const req = new Request('https://test/', { headers, cf: { asn, asOrganization: asn === 4134 ? 'China Telecom' : 'Node Host' } });
    return recordClient(env as unknown as Env, req, device);
  };
  await call('d-old', 'alt_port', 4134); // an older build: no failure header
  await call('d-rep', 'doh', 4134, 'system_dns, pinned,carrier_pigeon');
  await call('d-relay', 'relay', 906, 'system_dns');
  await call('d-relay', 'relay', 906, 'system_dns'); // same path within the hour: no stamp, no count
  await call('d-exit', 'pinned', 64500); // through a Tono exit: the ASN is the node's

  const body = await loadApiPaths(db(), t);
  expect(body.since).toBe(today - 6 * DAY);
  const rows = body.rows
    .map((r) => [r.asn, r.path, r.arrived, r.ok, r.fail, r.successRate.value, r.asOrg] as const)
    .sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
  expect(rows).toEqual([
    [4134, 'alt_port', 1, 0, 0, null, 'China Telecom'],
    [4134, 'doh', 1, 1, 0, 1, 'China Telecom'],
    [4134, 'pinned', 0, 0, 1, 0, 'China Telecom'],
    [4134, 'system_dns', 2, 0, 1, 0, 'China Telecom'],
    [null, 'pinned', 1, 0, 0, null, null],
    [null, 'relay', 1, 1, 0, 1, null],
    [null, 'system_dns', 0, 0, 1, 0, null],
  ]);
  const unrated = body.rows.find((r) => r.path === 'alt_port');
  expect(unrated?.successRate).toEqual({ value: null, asOfSec: null, source: 'telemetry' });
});
