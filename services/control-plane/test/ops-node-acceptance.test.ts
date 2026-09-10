import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { encryptCatalog, sha256 } from '../src/crypto';
import { assertNodeAcceptance } from '../src/ops/contract';
import {
  bindingItems,
  capacityItem,
  carriersItem,
  errorsItem,
  forwardItem,
  profileItem,
  quotaItem,
  standbyItem,
} from '../src/ops/handlers/nodes-acceptance-items';
import type {
  ForwardPathDto,
  NodeBindingsDto,
  NodeFactsDto,
  NodeQuotaDto,
  ReturnPathDto,
} from '../src/ops/contract';

/**
 * 可售验收单, both halves.
 *
 * The item table is checked as a table: every line of the sheet has a state
 * it must reach on a given fact and a state it must not, and the difference
 * between "nobody measured" and "measured and bad" is the one this file exists
 * to hold — a node that has never been probed must not read as a node that
 * passed its probe.
 *
 * The endpoint half checks the thing the items cannot: that 上架 refuses a node
 * the sheet says is not sellable, that `override: true` is a real second path
 * rather than a way round the check, and that taking it leaves a record.
 */

const ACCESS_TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
const ACCESS_AUDIENCE = 'test-access-audience-0001';
const ACCESS_ADMIN_EMAIL = 'operator@example.com';
const OIDC_KEY_ID = 'test-oidc-key';
const NODE = 'Tokyo · Fuji';
const SIBLING = 'Tokyo · Kite';
/** Real time, so "fresh ≤26 h" and "within 7 days" mean what they say. */
const NOW = Math.floor(Date.now() / 1_000);
const DAY = 86_400;

let oidcPrivateKey: CryptoKey;
let oidcPublicKey: JsonWebKey & { kid: string };

const base64URL = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessAssertion(accessEmail: string) {
  const encode = (value: object) => base64URL(new TextEncoder().encode(JSON.stringify(value)));
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: OIDC_KEY_ID });
  const payload = encode({
    iss: `https://${ACCESS_TEAM_DOMAIN}`,
    aud: ACCESS_AUDIENCE,
    sub: `access-user-${accessEmail}`,
    email: accessEmail,
    iat: issuedAt,
    exp: issuedAt + 300,
  });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    oidcPrivateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64URL(new Uint8Array(signature))}`;
}

async function ops(path: string, init: RequestInit = {}) {
  const context = createExecutionContext();
  const headers = new Headers(init.headers);
  if (!headers.has('cf-access-jwt-assertion')) {
    headers.set('cf-access-jwt-assertion', await accessAssertion(ACCESS_ADMIN_EMAIL));
  }
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await worker.fetch(
    new Request(`https://test/api/v1/ops/${path}`, { ...init, headers }),
    env as unknown as Env,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const post = (value: unknown): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
});

const db = () => (env as unknown as { DB: D1Database }).DB;
const enc = encodeURIComponent(NODE);

/* --------------------------------------------------------- the item table */

const FACTS: NodeFactsDto = {
  publicIp: '203.0.113.9', os: 'debian-12', region: 'tyo', provider: 'Bandwagon',
  providerAccountId: null, lineTags: ['CN2 GIA'], port: 443, price: 12.5, currency: 'USD',
  billingCycle: 30, renewsAt: NOW + 30 * DAY, expiresAt: null, notes: null,
  createdAt: NOW - DAY, updatedAt: NOW - 60,
};

const BINDINGS: NodeBindingsDto = {
  catalog: true, exitToken: true, komari: true, identitySync: true, metering: true,
  asOfSec: NOW - 60,
};

function ret(rows: Partial<ReturnPathDto>[], asOf: number | null) {
  return {
    rows: rows.map((row) => ({
      carrier: 'unicom', latencyMs: 80, lossPct: 0.01, samples: 20, ...row,
    })) as ReturnPathDto[],
    asOf,
  };
}

const THREE = ret(
  [{ carrier: 'unicom' }, { carrier: 'telecom' }, { carrier: 'mobile' }],
  NOW - 3_600,
);

function forward(rows: Partial<ForwardPathDto>[], asOf: number | null) {
  return {
    rows: rows.map((row) => ({
      carrier: 'unicom', successRate: null, medianTcpMs: null, topFailure: null,
      attempts: 0, users: 0, ...row,
    })) as ForwardPathDto[],
    asOf,
  };
}

const QUOTA: NodeQuotaDto = {
  quota: 1_000 * 1000 ** 3, used: 10, pct: 0.001, projectedExhaustAt: null,
  level: 'ok', cycleKind: 'calendar_day', cycleStart: NOW - DAY, cycleEnd: NOW + 29 * DAY,
  counts: 'in_out',
};

describe('每一条验收', () => {
  it('资料齐全 is a fail with the missing fields named, never an unknown', () => {
    expect(profileItem(FACTS).state).toBe('pass');
    const bare = profileItem({ ...FACTS, price: null, lineTags: [] });
    expect(bare.state).toBe('fail');
    expect(bare.evidence).toContain('价格');
    expect(bare.evidence).toContain('线路标签');
    // 续费日 or 到期日 — either one answers the question.
    expect(profileItem({ ...FACTS, renewsAt: null, expiresAt: NOW + DAY }).state).toBe('pass');
    expect(profileItem({ ...FACTS, renewsAt: null, expiresAt: null }).state).toBe('fail');
  });

  it('五处登记 is five lines, so a refusal can name the one that is missing', () => {
    const all = bindingItems(BINDINGS, true);
    expect(all.map((row) => row.key)).toEqual([
      'binding.catalog', 'binding.exitToken', 'binding.komari',
      'binding.identitySync', 'binding.metering',
    ]);
    expect(all.every((row) => row.state === 'pass')).toBe(true);

    const one = bindingItems({ ...BINDINGS, identitySync: false }, true);
    expect(one.filter((row) => row.state === 'fail').map((row) => row.key)).toEqual(['binding.identitySync']);

    // A catalog nobody could decode is not the same as a node that is not in it.
    const blind = bindingItems({ ...BINDINGS, catalog: false }, null);
    expect(blind[0].state).toBe('unknown');
  });

  it('大陆三网探测 separates never-swept, stale, walled and short of a carrier', () => {
    expect(carriersItem(THREE, null, false, NOW).state).toBe('pass');
    expect(carriersItem(ret([], null), null, false, NOW).state).toBe('unknown');
    // A probe already queued is an answer on its way, not a missing one.
    expect(carriersItem(ret([], null), null, true, NOW).state).toBe('pending');
    const stale = carriersItem(ret(
      [{ carrier: 'unicom' }, { carrier: 'telecom' }, { carrier: 'mobile' }],
      NOW - 30 * 3_600,
    ), null, false, NOW);
    expect(stale.state).toBe('fail');
    expect(stale.evidence).toContain('小时前');
    const walled = carriersItem(THREE, '疑似被墙', false, NOW);
    expect(walled.state).toBe('fail');
    expect(walled.source).toBe('collector');
    const short = carriersItem(
      ret([{ carrier: 'unicom' }, { carrier: 'telecom' }], NOW - 3_600), null, false, NOW,
    );
    expect(short.state).toBe('fail');
    expect(short.evidence).toContain('移动');
  });

  it('客户去程 tells nobody tried from a everybody failed', () => {
    const none = forwardItem(forward([{ carrier: 'unicom' }], null));
    expect(none.state).toBe('unknown');
    expect(none.evidence).toBe('还没有客户连过');
    expect(none.asOfSec).toBeNull();

    const failed = forwardItem(forward([{ carrier: 'mobile', attempts: 8, successRate: 0 }], NOW - 60));
    expect(failed.state).toBe('fail');

    const worked = forwardItem(forward([{ carrier: 'mobile', attempts: 8, successRate: 0.75 }], NOW - 60));
    expect(worked.state).toBe('pass');
    expect(worked.evidence).toContain('6');
  });

  it('后台无报错 needs the digest to have run before a quiet day means anything', () => {
    expect(errorsItem([], null, NOW).state).toBe('unknown');
    const today = Math.floor(NOW / DAY) * DAY;
    expect(errorsItem([{ dayAt: today, category: 'dial_timeout', count: 3, sample: null }], NOW, NOW).state)
      .toBe('pass');
    const loud = errorsItem(
      [{ dayAt: today, category: 'dial_timeout', count: 12, sample: null }], NOW, NOW,
    );
    expect(loud.state).toBe('fail');
    expect(loud.evidence).toContain('dial_timeout');
    // Yesterday's noise is not this machine's problem today.
    expect(errorsItem(
      [{ dayAt: today - DAY, category: 'dial_timeout', count: 90, sample: null }], NOW, NOW,
    ).state).toBe('pass');
  });

  it('流量配额已设 wants both the allowance and a cycle that is running', () => {
    expect(quotaItem(QUOTA, NOW).state).toBe('pass');
    expect(quotaItem({ ...QUOTA, quota: null }, NOW).state).toBe('fail');
    expect(quotaItem({ ...QUOTA, cycleStart: null }, NOW).state).toBe('fail');
  });

  it('容量 stays unknown, because nothing writes down what the box holds', () => {
    const empty = capacityItem({ rows: [], asOf: null });
    expect(empty.state).toBe('unknown');
    expect(empty.asOfSec).toBeNull();
    const busy = capacityItem({ rows: [{}, {}] as never[], asOf: NOW - 30 });
    expect(busy.state).toBe('unknown');
    expect(busy.evidence).toContain('2');
  });

  it('替代机器 is a fail when nothing covers for the machine', () => {
    const names = new Set([NODE, SIBLING]);
    expect(standbyItem('tyo', [SIBLING], names, NOW).state).toBe('pass');
    expect(standbyItem('tyo', [], names, NOW).state).toBe('fail');
    const noRegion = standbyItem(null, [], names, NOW);
    expect(noRegion.state).toBe('fail');
    expect(noRegion.evidence).toContain('地区');
    expect(standbyItem('tyo', [], null, NOW).state).toBe('unknown');
  });
});

/* ------------------------------------------------------------- the wire */

async function seedCatalog(names: string[]) {
  const e = env as unknown as Env & { CATALOG_ENCRYPTION_KEY?: string };
  const yaml = [
    'proxies:',
    ...names.flatMap((name) => [
      `  - name: ${name}`,
      '    type: vless',
      '    server: 203.0.113.10',
      '    port: 443',
      '    uuid: {{TONO_CLIENT_UUID}}',
    ]),
    'proxy-groups:',
    '  - name: Tono-Exit',
    '    type: select',
    '    proxies:',
    ...names.map((name) => `      - ${name}`),
    'rules:',
    '  - MATCH,Tono-Exit',
  ].join('\n') + '\n';
  const encrypted = await encryptCatalog(yaml, e.CATALOG_ENCRYPTION_KEY!);
  await db().prepare(
    `INSERT INTO managed_exit_catalog(singleton_id, revision, ciphertext, nonce, content_sha256, updated_at)
     VALUES(1, 1, ?, ?, ?, ?)`,
  ).bind(encrypted.ciphertext, encrypted.nonce, await sha256(yaml), NOW).run();
}

/** A node with nothing behind it but its own name, so every line has to say so. */
async function seedBare(name = NODE) {
  await db().prepare(
    `INSERT INTO ops_node_profiles(id, catalog_name, status, created_at, updated_at)
     VALUES(?, ?, 'active', ?, ?)`,
  ).bind(`p-${name}`, name, NOW, NOW).run();
  await db().prepare(
    `INSERT INTO ops_node_status(
       node_name, verdict, label, reason, candidate_streak, catalog_listed,
       rules_version, evaluated_at, changed_at
     ) VALUES(?, 'unknown', '未测', NULL, 0, 0, 1, ?, ?)`,
  ).bind(name, NOW, NOW).run();
}

/** Everything the sheet asks for, so 上架 goes through without an override. */
async function seedSellable() {
  await seedCatalog([NODE, SIBLING]);
  for (const [name, region] of [[NODE, 'tyo'], [SIBLING, 'tyo']] as const) {
    await db().prepare(
      `INSERT INTO ops_node_profiles(
         id, catalog_name, status, provider, price, currency, billing_cycle, renews_at,
         region, line_tags_json, created_at, updated_at
       ) VALUES(?, ?, 'active', 'Bandwagon', 12.5, 'USD', 30, ?, ?, ?, ?, ?)`,
    ).bind(`p-${name}`, name, NOW + 30 * DAY, region, JSON.stringify(['CN2 GIA']), NOW, NOW).run();
    await db().prepare(
      `INSERT INTO exit_nodes(
         id, name, token_hash, status, last_roster_at, metering_last_seen_at, created_at, updated_at
       ) VALUES(?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(
      `x-${name}`, name, `${name}`.padEnd(43, 'h').slice(0, 43),
      NOW, NOW, NOW, NOW,
    ).run();
  }
  await db().prepare(
    `INSERT INTO ops_node_status(
       node_name, verdict, label, reason, candidate_streak, catalog_listed,
       rules_version, evaluated_at, changed_at
     ) VALUES(?, 'ok', '大陆正常', 'ok', 0, 1, 1, ?, ?)`,
  ).bind(NODE, NOW, NOW).run();

  const carrier = { latencyMs: 80, lossPct: 0.01, samples: 20, targets: [], history: [] };
  await db().prepare(
    `INSERT INTO operations_live_snapshot(
       singleton_id, quality_json, agents_json, quality_updated_at, agents_updated_at, updated_at
     ) VALUES(1, NULL, ?, NULL, ?, ?)`,
  ).bind(
    JSON.stringify([{
      name: NODE, observedAt: NOW - 300,
      carriers: { unicom: carrier, telecom: carrier, mobile: carrier },
    }]),
    NOW, NOW,
  ).run();

  await db().prepare(
    `INSERT INTO users(id, email, password_hash, password_salt, status, usage_bytes, created_at, updated_at)
     VALUES('u-1', 'a@example.com', 'x', 'y', 'active', 0, ?, ?)`,
  ).bind(NOW, NOW).run();
  await db().prepare(
    `INSERT INTO connection_events(
       id, at_ms, received_at, source, user_id, kind, node, tcp_delay_ms, edge_as_org, edge_via_exit
     ) VALUES('e1', ?, ?, 'window', 'u-1', 'connectOk', ?, 40, 'China Mobile', 0)`,
  ).bind((NOW - 3_600) * 1_000, NOW, NODE).run();

  await db().prepare(
    `INSERT INTO ops_node_jobs(
       id, node_name, executor, type, params_json, status, attempts, max_attempts,
       idempotency_key, requested_by, created_at, not_before, expires_at, completed_at, updated_at
     ) VALUES('job-digest', ?, 'hub', 'xray_error_digest', '{}', 'succeeded', 1, 3,
              'idem-digest', ?, ?, ?, ?, ?, ?)`,
  ).bind(NODE, ACCESS_ADMIN_EMAIL, NOW - 3_600, NOW - 3_600, NOW + 900, NOW - 3_000, NOW).run();

  await db().prepare(
    `INSERT INTO node_traffic_cycles(
       id, node_name, cycle_start, cycle_end, quota_bytes, used_bytes, status, updated_at
     ) VALUES('cyc-1', ?, ?, ?, ?, 1000, 'open', ?)`,
  ).bind(NODE, NOW - DAY, NOW + 29 * DAY, 1_000 * 1000 ** 3, NOW).run();
}

describe('nodes/{name}/acceptance and the 上架 gate', () => {
  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify'],
    ) as CryptoKeyPair;
    oidcPrivateKey = keyPair.privateKey;
    oidcPublicKey = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: OIDC_KEY_ID, use: 'sig', alg: 'RS256' };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (request.url === `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return Response.json({ keys: [oidcPublicKey] }, { headers: { 'cache-control': 'public, max-age=300' } });
      }
      return new Response(null, { status: 404 });
    });
  });

  beforeEach(() => {
    (env as unknown as Env).ACCESS_TEAM_DOMAIN = ACCESS_TEAM_DOMAIN;
    (env as unknown as Env).ACCESS_AUD = ACCESS_AUDIENCE;
    (env as unknown as Env).ACCESS_ADMIN_EMAILS = ACCESS_ADMIN_EMAIL;
    (env as unknown as Env & { OPS_CONTRACT_STRICT?: string }).OPS_CONTRACT_STRICT = '1';
  });

  it('a machine nobody has finished lists every line that is missing', async () => {
    await seedBare();
    const res = await ops(`nodes/${enc}/acceptance`);
    expect(res.status).toBe(200);
    const sheet = assertNodeAcceptance(await res.json());
    expect(sheet.items.length).toBe(12);
    expect(sheet.sellable).toBe(false);
    expect(sheet.blockers).toContain('profile');
    expect(sheet.blockers).toContain('carriers');
    expect(sheet.blockers).toContain('quota');
    // The two that need a real customer stay unknown and stay out of the way.
    expect(sheet.items.find((row) => row.key === 'forward')?.state).toBe('unknown');
    expect(sheet.items.find((row) => row.key === 'capacity')?.state).toBe('unknown');
    expect(sheet.blockers).not.toContain('forward');
    expect(sheet.blockers).not.toContain('capacity');
  });

  it('上架 is refused with the blockers, and the override is a second path that is written down', async () => {
    await seedBare();
    const refused = await ops(`nodes/${enc}/jobs`, post({ type: 'catalog_relist', confirmName: NODE }));
    expect(refused.status).toBe(409);
    const body = await refused.json() as { error: { code: string }; blockers: string[] };
    expect(body.error.code).toBe('NOT_SELLABLE');
    expect(body.blockers.length).toBeGreaterThan(0);
    expect(await db().prepare('SELECT COUNT(*) AS n FROM ops_node_jobs').first<{ n: number }>())
      .toEqual({ n: 0 });

    const forced = await ops(`nodes/${enc}/jobs`, post({
      type: 'catalog_relist', confirmName: NODE, override: true,
    }));
    expect(forced.status).toBe(201);
    const audit = await db().prepare(
      "SELECT summary FROM ops_audit WHERE action = 'node.relist.override' AND target_id = ?",
    ).bind(NODE).first<{ summary: string }>();
    expect(audit?.summary).toContain('profile');
  });

  it('override does not travel with any other job type', async () => {
    await seedBare();
    const res = await ops(`nodes/${enc}/jobs`, post({
      type: 'collect_quality', override: true,
    }));
    expect(res.status).toBe(400);
  });

  it('a finished machine is sellable, and 上架 goes through without an override', async () => {
    await seedSellable();
    const sheet = assertNodeAcceptance(await (await ops(`nodes/${enc}/acceptance`)).json());
    expect(sheet.blockers).toEqual([]);
    expect(sheet.sellable).toBe(true);
    expect(sheet.asOfSec).not.toBeNull();
    expect(sheet.items.find((row) => row.key === 'forward')?.state).toBe('pass');
    expect(sheet.items.find((row) => row.key === 'standby')?.evidence).toContain(SIBLING);

    const relist = await ops(`nodes/${enc}/jobs`, post({ type: 'catalog_relist', confirmName: NODE }));
    expect(relist.status).toBe(201);
    const audit = await db().prepare(
      "SELECT COUNT(*) AS n FROM ops_audit WHERE action = 'node.relist.override'",
    ).first<{ n: number }>();
    expect(audit?.n).toBe(0);
  });
});
