#!/usr/bin/env node
// Capture GET /api/v1/ops/* from a wrangler origin into redacted JSON.
//
// The Worker still requires Cloudflare Access; against wrangler.fixtures.jsonc
// this script mints a JWT that the local JWKS hook will verify. Production
// captures pass --access-header with a real assertion.
import { createHash, createSign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { denseSeedSql, extrasSql } from '../../services/control-plane/preview/write-seed-dense.mjs';
import { previewSeedSql } from '../../services/control-plane/preview/seed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CONTROL = path.join(REPO, 'services', 'control-plane');

const ACCESS_TEAM = 'test-team.cloudflareaccess.com';
const ACCESS_AUD = 'test-access-audience-0001';
const ACCESS_EMAIL = 'operator@example.com';
const ACCESS_KID = 'tono-fixtures-access';
const ACCESS_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCdR06l3sx9Qnlj
vTcJqrUsx3yUH8b+j+5up5f7kx6GTWDqLsZu7W0d1TOE/rdW4+fHVqEi2U2LM1Ry
ZBHlqf4BOWR31HrBl9Bxx76yxtcABa28CoKcM12zm9Q9VlGMamIO3XQDW3dlJpAs
fufsqOPG3fwUG/D/si/fVDF5K2C522tomj0JYTrQMYfUrR5sbwTv3QuOba+ONC8c
c7M9LV7kSmmjqmfiU6LaE8K+nHBV0GQ2hcVrRwXriJJn7F410ushlUOdyuUQ/dI3
2RLx+j74cFcQTi6I2SBjVe9lwLvH7+hnqE++6vjNnfhLmKZ9GrRdl6gjJuQMsYPm
gfvdPgqZAgMBAAECggEAArJ2ue+3jkTZ79DOfTETHQ7ZNzGR0Cr/9eAUIkVwOjGg
wjdV4hBahQ7TTLoxAvGS15dn2UEEfEj/r1wBthBrmZIGQ+tOBRyhP5hDMA3qoTaX
t4AvI/ZaCqLXGYutx5SJ9LMNwqJ6ik6mXYr6F3QAfvgu0tn1UK85tLDdDdTFen5u
xlO/5MI2be1tjwoFpKJcUTJybHF1axNpLoS4rChvBv6Nvx0x6i/HQs+9LH98f1U7
DHb90PBP6lSDOaD3iqmMezEfbvo8fMl1OeDpAfETMNtxKWA31xuHX5QN/Q9k0pGp
dqE3vC/Fe+SHQv6P+z4lBh6sH6MWHz934ASiDhejEQKBgQDRVUmVPkh824/cPkWj
tehqCQHj9v6MwshhbDL44zXrps4AmVWoHHXFvXYgUM/meoXVS4a6S6BDFbwL7Dh+
gl5ZSV9ATpRxyud83Ad3y71FKnwKRDkT+BD5sLIEkWmp7zW40U/sQxv72e60+rIV
0oLCYdHQJ/zhrQmij3VSho24aQKBgQDAVz7zs0TjnzA1dfvPaa0ya+gjqKiY67+R
rwWo+2JETgKiO5L0s9sy/n3OG/0AHglpJZWZ5xp60r2B7H8+20Sz1+cOtEgGrDtm
9rV45tazCUpBZH8zmr+rq5+3cCu0JpNl/VGr2ugXQIByYGbIvtZpOYr2k3JFfluE
LgSk2HP6sQKBgQCcxh0Xss+jAuTY86JAG2p2j0xlKIQ3c2GS5O+/ypqFZCV/+VZX
Uwk5EM25Igyx9izpM2kxeJYL5+kvnLgqtwRmJjc5+B/goS+BKWBGbcXQWSMQpUuC
ExTTi2unVCgoZsh7I/eRYClDE1JdJCvfgAsB/TSfinMvqOJAZuRc6/yTkQKBgEvT
2YigGz+VqZ7Z9b0uj056hhlQy68F+g9ILfYRrQr6qkUlMWlxYrB27kgMdrDOJq2i
WJlFKAZWAMow33V7Yll4e6orXt3qlryf9KlGcExDFFg1c4R3tKrMTXo3KbOrJZ8m
wET9V1SbZEgzQzJPMh5nxiYxuPI2v4Ob1M7cWtTxAoGADgqYOiirf+C5BYiVKF5b
naqtO25r7to1/FadKJCfKlsAZ9IAZdwslCls6CCcWnf0X1DpIRveQNtVXjVIOffo
HHtazVkBiYbpMZYzMbZk9/9kT7H7s2hZALD5WvBFoQ4Dc3v7LxjTkw9Yu7e8ZCQr
82HaV5ErFRpN2fSbSuEUf7g=
-----END PRIVATE KEY-----`;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const ID_KEYS = new Set([
  'id', 'userId', 'deviceId', 'providerAccountId', 'incidentId', 'parentIncidentId',
  'ruleId', 'requestId', 'idempotencyKey', 'dedupeKey', 'targetId', 'ownerUserId',
]);
const TIME_KEYS = new Set([
  'at', 'atMs', 'asOfSec', 'updatedAt', 'createdAt', 'openedAt', 'lastSeenAt',
  'ackedAt', 'snoozedUntil', 'resolvedAt', 'publishedAt', 'withdrawnAt',
  'firstSeen', 'decidedAt', 'lastFiredAt', 'deliveredAt', 'receivedAt',
  'dayAt', 'hourAt', 'expiresAt', 'renewsAt', 'notBefore', 'leasedUntil',
  'finishedAt', 'connectedSince', 'firstEntitledAt', 'cycleStart', 'cycleEnd',
  'projectedExhaustAt', 'cronLastRunAt', 'cronLastDurationMs',
  'stageSinceAt', 'firstConnectedAt', 'verifiedAt',
  'computedAt', 'deadlineSec', 'evidenceAsOfSec',
]);

const V1_GET = [
  ['GET /api/v1/ops/nodes', 'assertNodeSummaryList', '?limit=200'],
  ['GET /api/v1/ops/nodes/{name}', 'assertNodeDetail', ''],
  ['GET /api/v1/ops/nodes/{name}/history', 'assertNodeHistoryList', '?limit=200'],
  ['GET /api/v1/ops/nodes/{name}/connections', 'assertNodeConnectionsList', '?limit=200'],
  ['GET /api/v1/ops/nodes/{name}/errors', 'assertNodeErrorsMeasured', '?range=7d'],
  ['GET /api/v1/ops/nodes/{name}/bindings', 'assertNodeBindings', ''],
  ['GET /api/v1/ops/nodes/{name}/jobs', 'assertNodeJobsList', ''],
  ['GET /api/v1/ops/customers', 'assertCustomerSummaryList', '?limit=200'],
  ['GET /api/v1/ops/customers/{id}', 'assertCustomerDetail', ''],
  ['GET /api/v1/ops/customers/{id}/connections', 'assertCustomerConnectionsList', '?limit=200'],
  ['GET /api/v1/ops/customers/{id}/activity', 'assertCustomerActivityList', '?range=24h'],
  ['GET /api/v1/ops/customers/{id}/destinations', 'assertCustomerDestinationsList', '?range=7d'],
  ['GET /api/v1/ops/customers/{id}/services', 'assertCustomerServicesList', '?range=7d'],
  ['GET /api/v1/ops/incidents', 'assertIncidentList', '?limit=200'],
  ['GET /api/v1/ops/incidents/{id}', 'assertIncidentDetail', ''],
  ['GET /api/v1/ops/jobs', 'assertJobList', '?limit=200'],
  ['GET /api/v1/ops/releases', 'assertReleaseList', ''],
  ['GET /api/v1/ops/releases/adoption', 'assertAdoptionMatrix', '?range=30d'],
  ['GET /api/v1/ops/direct-candidates', 'assertDirectCandidateList', ''],
  ['GET /api/v1/ops/provider-accounts', 'assertProviderAccountList', ''],
  ['GET /api/v1/ops/provider-accounts/{id}', 'assertProviderAccount', ''],
  ['GET /api/v1/ops/home-lines', 'assertHomeLineList', ''],
  ['GET /api/v1/ops/home-lines/{id}', 'assertHomeLine', ''],
  ['GET /api/v1/ops/home-lines/{id}/usage', 'assertHomeLineUsageList', '?range=30d'],
  ['GET /api/v1/ops/alert-rules', 'assertAlertRuleList', ''],
  ['GET /api/v1/ops/alert-rules/{id}', 'assertAlertRule', ''],
  ['GET /api/v1/ops/alert-deliveries', 'assertAlertDeliveryList', ''],
  ['GET /api/v1/ops/audit', 'assertAuditList', ''],
  ['GET /api/v1/ops/system/health', 'assertSystemHealth', ''],
  ['GET /api/v1/ops/digest', 'assertDigest', ''],
  ['GET /api/v1/ops/months/{month}', 'assertMonthSummary', ''],
];

const EXTRA_GET = [
  ['GET /api/v1/ops/fleet-nodes', 'passthrough', ''],
  ['GET /api/v1/ops/live', 'passthrough', ''],
];

function usage() {
  process.stdout.write(`usage: node tooling/scripts/capture-ops-fixtures.mjs --base <url> --out <dir> --freeze-now <unix> [options]

Capture every GET ops route from a wrangler origin, redact, freeze timestamps,
and write <out>/<route-with-slashes-as-dashes>.json plus index.json.

Options:
  --base <url>             wrangler dev origin, e.g. http://127.0.0.1:8787
  --out <dir>              output directory
  --freeze-now <unix>      epoch seconds used as the captured clock
  --access-header <h: v>   extra header (repeatable). Default mints
                           cf-access-jwt-assertion for wrangler.fixtures.jsonc
  --scenario normal|dense  dense seeds 45 nodes / 60 customers / 400 events / 12 incidents
  --apply-seed             execute the scenario SQL against local D1 before GET
  --config <file>          wrangler config for --apply-seed (default wrangler.fixtures.jsonc)
  --help
`);
}

function fixtureFileForRoute(route) {
  const pathPart = route.replace(/^GET \/api\/v1\/ops\//, '');
  return `${pathPart.replace(/[{}]/g, '').replaceAll('/', '-')}.json`;
}

function mintAccessJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: ACCESS_KID });
  const payload = encode({
    iss: `https://${ACCESS_TEAM}`,
    aud: ACCESS_AUD,
    sub: `access-user-${ACCESS_EMAIL}`,
    email: ACCESS_EMAIL,
    iat: now,
    exp: now + 3600,
  });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(ACCESS_PEM).toString('base64url')}`;
}

function parseArgs(argv) {
  const out = {
    base: null,
    outDir: null,
    freezeNow: null,
    accessHeaders: [],
    scenario: 'normal',
    applySeed: false,
    config: path.join(CONTROL, 'wrangler.fixtures.jsonc'),
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--help' || flag === '-h') out.help = true;
    else if (flag === '--apply-seed') out.applySeed = true;
    else if (flag === '--base' && value) { out.base = value; i += 1; }
    else if (flag === '--out' && value) { out.outDir = value; i += 1; }
    else if (flag === '--freeze-now' && value) { out.freezeNow = Number(value); i += 1; }
    else if (flag === '--access-header' && value) { out.accessHeaders.push(value); i += 1; }
    else if (flag === '--scenario' && value) { out.scenario = value; i += 1; }
    else if (flag === '--config' && value) { out.config = path.resolve(value); i += 1; }
    else throw new Error(`unknown argument: ${flag}`);
  }
  return out;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stderr || stdout}`));
    });
  });
}

function createRedactor(freezeNow, capturedNowSec, keepText) {
  const emails = new Map();
  const ips = new Map();
  const ids = new Map();
  const delta = freezeNow - capturedNowSec;

  const emailFor = (raw) => {
    const key = raw.toLowerCase();
    if (!emails.has(key)) emails.set(key, `user${emails.size + 1}@example.test`);
    return emails.get(key);
  };
  const ipFor = (raw) => {
    if (!ips.has(raw)) ips.set(raw, `203.0.113.${(ips.size % 254) + 1}`);
    return ips.get(raw);
  };
  const idFor = (raw) => {
    if (keepText.has(raw)) return raw;
    if (!ids.has(raw)) {
      const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16);
      ids.set(raw, `id_${digest}`);
    }
    return ids.get(raw);
  };
  const shiftTime = (value) => {
    if (!Number.isFinite(value)) return value;
    if (value >= 1e12 && value < 4e12) return Math.round(value + delta * 1000);
    if (value >= 1e9 && value < 4e9) return Math.round(value + delta);
    return value;
  };
  const redactString = (value) => value
    .replace(EMAIL_RE, (match) => emailFor(match))
    .replace(IPV4_RE, (match) => ipFor(match));

  const walk = (value, key) => {
    if (value == null) return value;
    if (typeof value === 'number') {
      if (key && TIME_KEYS.has(key)) return shiftTime(value);
      return value;
    }
    if (typeof value === 'string') {
      if (key && ID_KEYS.has(key)) return idFor(value);
      return redactString(value);
    }
    if (Array.isArray(value)) return value.map((entry) => walk(entry, key));
    if (typeof value === 'object') {
      const next = {};
      for (const [child, entry] of Object.entries(value)) next[child] = walk(entry, child);
      return next;
    }
    return value;
  };
  return { walk };
}

function fillPath(route, ids) {
  let pathPart = route.replace(/^GET /, '');
  if (pathPart.includes('{name}')) {
    if (!ids.nodeName) return null;
    pathPart = pathPart.replaceAll('{name}', encodeURIComponent(ids.nodeName));
  }
  if (pathPart.includes('{id}')) {
    const needed = route.includes('/customers/')
      ? ids.customerId
      : route.includes('/incidents/')
        ? ids.incidentId
        : route.includes('/provider-accounts/')
          ? ids.providerId
          : route.includes('/home-lines/')
            ? ids.homeLineId
            : route.includes('/alert-rules/')
              ? ids.alertRuleId
              : null;
    if (!needed) return null;
    pathPart = pathPart.replaceAll('{id}', encodeURIComponent(needed));
  }
  if (pathPart.includes('{month}')) {
    if (!ids.month) return null;
    pathPart = pathPart.replaceAll('{month}', encodeURIComponent(ids.month));
  }
  return pathPart;
}

function firstItem(body, key) {
  if (!body || typeof body !== 'object') return null;
  if (Array.isArray(body.items) && body.items[0]) return body.items[0][key] ?? null;
  if (Array.isArray(body.entries) && body.entries[0]) return body.entries[0][key] ?? null;
  return null;
}

function collectKeep(body, keep) {
  if (!body || typeof body !== 'object') return;
  if (typeof body.name === 'string') keep.add(body.name);
  if (typeof body.node === 'string') keep.add(body.node);
  if (typeof body.etld1 === 'string') keep.add(body.etld1);
  if (typeof body.edgeAsOrg === 'string') keep.add(body.edgeAsOrg);
  if (Array.isArray(body.items)) for (const row of body.items) collectKeep(row, keep);
  if (Array.isArray(body.nodes)) for (const row of body.nodes) collectKeep(row, keep);
}

async function getJson(base, pathPart, headers) {
  const url = new URL(pathPart, base.endsWith('/') ? base : `${base}/`);
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, body, etag: response.headers.get('etag') };
}

async function applySeed(scenario, config) {
  const sql = scenario === 'dense' ? denseSeedSql() : `${previewSeedSql}\n${extrasSql()}\n`;
  const tmp = path.join(CONTROL, `.wrangler/tono-fixtures-${scenario}.sql`);
  await mkdir(path.dirname(tmp), { recursive: true });
  await writeFile(tmp, sql);
  await run('npx', [
    'wrangler', 'd1', 'execute', 'tono-control-plane', '--local',
    '--config', config, '--persist-to', '.wrangler/state',
    '--file', tmp, '--yes',
  ], CONTROL);
}

async function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (args.help) { usage(); return; }
  if (!args.base || !args.outDir || !Number.isFinite(args.freezeNow) || args.freezeNow <= 0) {
    usage();
    process.exitCode = 1;
    return;
  }
  if (args.scenario !== 'normal' && args.scenario !== 'dense') {
    process.stderr.write('--scenario must be normal or dense\n');
    process.exitCode = 1;
    return;
  }
  if (args.scenario === 'dense' || args.applySeed) {
    await applySeed(args.scenario, args.config);
  }

  const headers = { accept: 'application/json' };
  if (args.accessHeaders.length === 0) {
    headers['cf-access-jwt-assertion'] = mintAccessJwt();
  } else {
    for (const raw of args.accessHeaders) {
      const split = raw.indexOf(':');
      if (split < 1) throw new Error(`invalid --access-header: ${raw}`);
      headers[raw.slice(0, split).trim().toLowerCase()] = raw.slice(split + 1).trim();
    }
  }

  const capturedNowSec = Math.floor(Date.now() / 1000);
  const keep = new Set();
  const ids = {
    nodeName: null, customerId: null, incidentId: null,
    providerId: null, homeLineId: null, alertRuleId: null,
    month: new Date(capturedNowSec * 1000).toISOString().slice(0, 7),
  };

  const listsFirst = [
    ['GET /api/v1/ops/nodes', '?limit=200'],
    ['GET /api/v1/ops/customers', '?limit=200'],
    ['GET /api/v1/ops/incidents', '?limit=200'],
    ['GET /api/v1/ops/provider-accounts', ''],
    ['GET /api/v1/ops/home-lines', ''],
    ['GET /api/v1/ops/alert-rules', ''],
  ];
  for (const [route, query] of listsFirst) {
    const filled = `${fillPath(route, ids)}${query}`;
    const got = await getJson(args.base, filled, headers);
    collectKeep(got.body, keep);
    if (route.endsWith('/nodes')) ids.nodeName = firstItem(got.body, 'name');
    if (route.endsWith('/customers')) ids.customerId = firstItem(got.body, 'userId');
    if (route.endsWith('/incidents')) ids.incidentId = firstItem(got.body, 'id');
    if (route.endsWith('/provider-accounts')) ids.providerId = firstItem(got.body, 'id');
    if (route.endsWith('/home-lines')) ids.homeLineId = firstItem(got.body, 'id');
    if (route.endsWith('/alert-rules')) ids.alertRuleId = firstItem(got.body, 'id');
  }

  const redactor = createRedactor(args.freezeNow, capturedNowSec, keep);
  const index = [];
  const outDir = path.resolve(args.outDir);
  await mkdir(outDir, { recursive: true });

  for (const [route, checker, query] of [...EXTRA_GET, ...V1_GET]) {
    const filled = fillPath(route, ids);
    const file = fixtureFileForRoute(route);
    if (!filled) {
      process.stderr.write(`skip ${route}: missing path parameter\n`);
      continue;
    }
    const got = await getJson(args.base, `${filled}${query}`, headers);
    if (got.status !== 200) {
      throw new Error(`${route} returned ${got.status}: ${JSON.stringify(got.body)}`);
    }
    collectKeep(got.body, keep);
    const redacted = redactor.walk(got.body, null);
    await writeFile(path.join(outDir, file), `${JSON.stringify(redacted, null, 2)}\n`);
    index.push({ route, file, checker });
  }

  await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify({
    scenario: args.scenario,
    freezeNow: args.freezeNow,
    routes: index,
  }, null, 2)}\n`);
  process.stdout.write(`wrote ${index.length} fixtures to ${outDir}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
