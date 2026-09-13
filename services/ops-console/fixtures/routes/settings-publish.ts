import type { IncomingMessage, ServerResponse } from 'node:http';
import { nowSec } from '../../src/lib/clock';

/**
 * The fixture half of the three 设置 sections that publish something.
 *
 * These endpoints predate the typed contract, so there are no captured
 * responses to seed from; the shapes below are read off the Worker
 * (`shared-admin/catalog.ts`, `shared-admin/traffic-policy.ts`,
 * `shared-admin/home-exits.ts`, `reads/catalog-revisions.ts`) and the store is
 * mutable for the same reason the incident store is: a publish that the next
 * read does not agree with proves nothing.
 *
 * `?fixtures=conflict` is the one deliberately hostile variant. A publish there
 * always loses the race — the stored document moves a version and answers 409 —
 * because the console's most expensive bug would be a lost publish, and the
 * only way to keep testing that path is to be able to ask for it.
 */

const HOUR = 3_600;
const DAY = 86_400;

export type CatalogVersion = {
  revision: number;
  sha256: string;
  publishedAt: number;
  serverCount: number;
  logicalNodeCount: number;
  deploymentCount: number;
};

export type FixtureHomeExit = {
  id: string;
  proxyName: string;
  displayName: string;
  egressIpv4?: string;
  kind: string;
  socks5Host?: string;
  socks5Port?: number;
  status: string;
  notes?: string;
  bindCount: number;
  lastProbedAt?: number;
  probeStatus?: string;
  probeAlive?: number;
  probeTotal?: number;
  createdAt: number;
  updatedAt: number;
  /** Never served. Held only so an import can tell a duplicate line from a new one. */
  socks5Username?: string;
};

export type PublishStore = {
  catalog: { revision: number; yaml: string; sha256: string; updatedAt: number | null };
  history: CatalogVersion[];
  policy: { revision: number; json: string; sha256: string; updatedAt: number | null; signature: string | null };
  homeExits: FixtureHomeExit[];
  bindings: Array<{ userId: string; email: string; homeExitId: string; proxyName: string }>;
};

const SEED_YAML = `proxies:
  - name: tokyo-01
    type: vless
    server: tokyo-01.example.net
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.example.com
  - name: osaka-02
    type: vless
    server: osaka-02.example.net
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.example.com
  - name: seoul-03
    type: vless
    server: seoul-03.example.net
    port: 443
    uuid: {{TONO_CLIENT_UUID}}
    tls: true
    servername: www.example.com
proxy-groups:
  - name: auto
    type: url-test
    proxies: [tokyo-01, osaka-02, seoul-03]
`;

const SEED_POLICY = {
  version: 4,
  domains: [{ host: 'wechat.com', ports: [443] }],
  mediaEndpoints: [{ address: '203.0.113.7', ports: [8000] }],
  webDomains: [{ host: 'bilibili.com', ports: [443] }],
  directSuffixes: [{ host: 'baidu.com', ports: [443] }],
  tcpEndpoints: [],
};

/** A stable stand-in for the hub's sha256: same text, same fingerprint. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  }
  const word = hash.toString(16).padStart(8, '0');
  return word.repeat(8).slice(0, 64);
}

export function createPublishStore(empty: boolean): PublishStore {
  const now = nowSec();
  if (empty) {
    const bare = 'proxies: []\n';
    return {
      catalog: { revision: 0, yaml: bare, sha256: fingerprint(bare), updatedAt: null },
      history: [],
      policy: {
        revision: 0,
        json: JSON.stringify({ version: 1, domains: [], mediaEndpoints: [] }),
        sha256: fingerprint('empty-policy'),
        updatedAt: null,
      signature: null,
      },
      homeExits: [],
      bindings: [],
    };
  }
  const policyJson = JSON.stringify(SEED_POLICY);
  return {
    catalog: {
      revision: 37,
      yaml: SEED_YAML,
      sha256: fingerprint(SEED_YAML),
      updatedAt: now - 5 * HOUR,
    },
    history: [
      { revision: 37, sha256: fingerprint(SEED_YAML), publishedAt: now - 5 * HOUR, serverCount: 3, logicalNodeCount: 3, deploymentCount: 3 },
      { revision: 36, sha256: fingerprint('r36'), publishedAt: now - 2 * DAY, serverCount: 3, logicalNodeCount: 3, deploymentCount: 3 },
      { revision: 35, sha256: fingerprint('r35'), publishedAt: now - 9 * DAY, serverCount: 2, logicalNodeCount: 2, deploymentCount: 2 },
    ],
    policy: {
      revision: 12,
      json: policyJson,
      sha256: fingerprint(policyJson),
      updatedAt: now - 30 * HOUR,
      signature: null,
    },
    homeExits: [
      {
        id: 'home_fixture_01',
        proxyName: 'home-socks5-a1b2c3d4',
        displayName: 'Preview Home Alpha',
        kind: 'socks5',
        socks5Host: '198.51.100.24',
        socks5Port: 41_080,
        socks5Username: 'alpha',
        status: 'active',
        bindCount: 2,
        lastProbedAt: now - 900,
        probeStatus: 'alive',
        probeAlive: 41,
        probeTotal: 44,
        createdAt: now - 60 * DAY,
        updatedAt: now - 2 * DAY,
      },
      {
        id: 'home_fixture_02',
        proxyName: 'home-socks5-99887766',
        displayName: 'Preview Home Beta',
        kind: 'socks5',
        socks5Host: '198.51.100.77',
        socks5Port: 41_081,
        socks5Username: 'beta',
        status: 'disabled',
        notes: 'line renewed monthly',
        bindCount: 0,
        lastProbedAt: now - 4 * HOUR,
        probeStatus: 'dead',
        probeAlive: 0,
        probeTotal: 12,
        createdAt: now - 40 * DAY,
        updatedAt: now - 6 * HOUR,
      },
      {
        id: 'home_fixture_03',
        proxyName: 'osaka-02',
        displayName: 'Preview Catalog Line',
        kind: 'catalog',
        egressIpv4: '203.0.113.42',
        status: 'active',
        bindCount: 0,
        createdAt: now - 12 * DAY,
        updatedAt: now - 12 * DAY,
      },
    ],
    bindings: [
      { userId: 'u-04', email: 'ada@example.test', homeExitId: 'home_fixture_01', proxyName: 'home-socks5-a1b2c3d4' },
      { userId: 'u-07', email: 'lin@example.test', homeExitId: 'home_fixture_01', proxyName: 'home-socks5-a1b2c3d4' },
    ],
  };
}

export type PublishRequest = {
  req: IncomingMessage;
  res: ServerResponse;
  parts: string[];
  query: URLSearchParams;
  store: PublishStore;
  note: (action: string, targetType: string, targetId: string | null, summary: string) => void;
  sendJson: (res: ServerResponse, body: unknown, status?: number) => void;
  sendEmpty: (res: ServerResponse, status: number) => void;
  readBody: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  newId: () => string;
};

function refuse(
  send: PublishRequest['sendJson'],
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  send(res, { error: { code, message } }, status);
}

/** What the console reads back off a line. Credentials are never in here. */
function publicExit(row: FixtureHomeExit) {
  const { socks5Username: _hidden, ...rest } = row;
  return rest;
}

type ParsedLine = { host: string; port: number; username: string; password: string; notes: string | null };

/** The three shapes `shared-admin/home-exits.ts` accepts, and nothing else. */
function parseLine(raw: string): ParsedLine | null {
  const line = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!line) return null;
  let host = '';
  let port = 0;
  let username = '';
  let password = '';
  let notes: string | null = null;
  if (/^socks5:\/\//i.test(line)) {
    let url: URL;
    try {
      url = new URL(line);
    } catch {
      return null;
    }
    host = url.hostname;
    port = Number(url.port);
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } else if (line.includes('@')) {
    const at = line.lastIndexOf('@');
    const auth = line.slice(0, at);
    const hostport = line.slice(at + 1);
    const colon = auth.indexOf(':');
    const mark = hostport.lastIndexOf(':');
    if (colon < 1 || mark < 1) return null;
    username = auth.slice(0, colon);
    password = auth.slice(colon + 1);
    host = hostport.slice(0, mark);
    port = Number(hostport.slice(mark + 1));
  } else {
    const parts = line.split(':');
    if (parts.length !== 4 && parts.length !== 5) return null;
    host = parts[0];
    port = Number(parts[1]);
    username = parts[2];
    password = parts[3];
    notes = parts[4] || null;
  }
  if (!host || !username || !password) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host, port, username, password, notes };
}

function catalogRoutes(request: PublishRequest): boolean {
  const { req, res, parts, query, store, sendJson, readBody, note } = request;
  if (parts.length !== 1) return false;
  if (req.method === 'GET') {
    sendJson(res, {
      revision: store.catalog.revision,
      yaml: store.catalog.yaml,
      sha256: store.catalog.sha256,
      ...(store.catalog.updatedAt === null ? {} : { updatedAt: store.catalog.updatedAt }),
    });
    return true;
  }
  if (req.method !== 'PUT') return false;
  void readBody(req).then((body) => {
    const yaml = typeof body.yaml === 'string' ? body.yaml : '';
    const expected = body.expectedRevision;
    if (!/^proxies\s*:/m.test(yaml)) {
      refuse(sendJson, res, 400, 'INVALID_CATALOG', 'Catalog must be bounded Clash YAML with a proxies section');
      return;
    }
    // The hostile variant: somebody else got there first, every time.
    if (query.get('fixtures') === 'conflict') {
      const drifted = `${store.catalog.yaml}# someone else published\n`;
      store.catalog = {
        revision: store.catalog.revision + 1,
        yaml: drifted,
        sha256: fingerprint(drifted),
        updatedAt: nowSec(),
      };
      refuse(sendJson, res, 409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
      return;
    }
    if (expected !== store.catalog.revision) {
      refuse(sendJson, res, 409, 'CATALOG_CONFLICT', 'Managed catalog changed; reload before replacing it');
      return;
    }
    const revision = store.catalog.revision + 1;
    const at = nowSec();
    const sha256 = fingerprint(yaml);
    store.catalog = { revision, yaml, sha256, updatedAt: at };
    const nodes = (yaml.match(/^\s*-\s+name:/gm) ?? []).length;
    store.history.unshift({
      revision,
      sha256,
      publishedAt: at,
      serverCount: nodes,
      logicalNodeCount: nodes,
      deploymentCount: nodes,
    });
    note('catalog.publish', 'managed_exit_catalog', String(revision), `published r${String(revision)}`);
    sendJson(res, { revision, sha256, updatedAt: at });
  });
  return true;
}

function policyRoutes(request: PublishRequest): boolean {
  const { req, res, parts, store, sendJson, readBody, note } = request;
  // The candidate draft lives with the rest of 直连候选; it is not a publish.
  if (parts[1] === 'draft-from-candidates') return false;
  if (parts.length !== 1) return false;
  if (req.method === 'GET') {
    sendJson(res, {
      revision: store.policy.revision,
      json: store.policy.json,
      sha256: store.policy.sha256,
      ...(store.policy.updatedAt === null ? {} : { updatedAt: store.policy.updatedAt }),
      ...(store.policy.signature === null ? {} : { signature: store.policy.signature }),
    });
    return true;
  }
  if (req.method !== 'PUT') return false;
  void readBody(req).then((body) => {
    const policy = body.policy;
    if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) {
      refuse(sendJson, res, 400, 'VALIDATION_ERROR', 'Invalid policy');
      return;
    }
    const json = JSON.stringify(policy);
    // The hub asks for a signature when the document only validates in trusted
    // mode; a v4 rule set with tcp endpoints is the case that does.
    const shape = policy as Record<string, unknown>;
    const required = Array.isArray(shape.tcpEndpoints) && shape.tcpEndpoints.length > 0;
    if (body.dryRun === true) {
      sendJson(res, {
        dryRun: true,
        json,
        sha256: fingerprint(json),
        signatureRequired: required,
        signatureContext: 'tono-traffic-policy-v1\n',
      });
      return;
    }
    if (required && typeof body.signature !== 'string') {
      refuse(sendJson, res, 400, 'VALIDATION_ERROR', 'Invalid traffic policy version or shape');
      return;
    }
    if (body.expectedRevision !== store.policy.revision) {
      refuse(sendJson, res, 409, 'TRAFFIC_POLICY_CONFLICT', 'Managed traffic policy changed; reload before replacing it');
      return;
    }
    const revision = store.policy.revision + 1;
    const at = nowSec();
    store.policy = {
      revision,
      json,
      sha256: fingerprint(json),
      updatedAt: at,
      signature: typeof body.signature === 'string' ? body.signature : null,
    };
    note('traffic-policy.publish', 'managed_traffic_policy', String(revision), `published r${String(revision)}`);
    sendJson(res, {
      revision,
      json,
      sha256: store.policy.sha256,
      updatedAt: at,
      ...(store.policy.signature === null ? {} : { signature: store.policy.signature }),
    });
  });
  return true;
}

function homeExitRoutes(request: PublishRequest): boolean {
  const { req, res, parts, store, sendJson, sendEmpty, readBody, note, newId } = request;
  const [, id] = parts;

  if (id === undefined) {
    if (req.method === 'GET') {
      sendJson(res, { homeExits: store.homeExits.map(publicExit) });
      return true;
    }
    if (req.method !== 'POST') return false;
    void readBody(req).then((body) => {
      const at = nowSec();
      const row: FixtureHomeExit = {
        id: newId(),
        proxyName: String(body.proxyName ?? ''),
        displayName: String(body.displayName ?? ''),
        kind: typeof body.kind === 'string' ? body.kind : 'catalog',
        status: 'active',
        bindCount: 0,
        createdAt: at,
        updatedAt: at,
      };
      if (typeof body.egressIpv4 === 'string') row.egressIpv4 = body.egressIpv4;
      if (typeof body.notes === 'string') row.notes = body.notes;
      if (typeof body.socks5Host === 'string') row.socks5Host = body.socks5Host;
      if (typeof body.socks5Port === 'number') row.socks5Port = body.socks5Port;
      if (typeof body.socks5Username === 'string') row.socks5Username = body.socks5Username;
      if (store.homeExits.some((entry) => entry.proxyName === row.proxyName)) {
        refuse(sendJson, res, 409, 'HOME_EXIT_CONFLICT', 'A home exit with this proxyName already exists');
        return;
      }
      store.homeExits.push(row);
      note('home.create', 'home_exit', row.id, row.displayName);
      sendJson(res, { homeExit: publicExit(row) }, 201);
    });
    return true;
  }

  if (id === 'import') {
    if (req.method !== 'POST') return false;
    void readBody(req).then((body) => {
      const lines = Array.isArray(body.lines) ? body.lines : [];
      const created: ReturnType<typeof publicExit>[] = [];
      const skipped: Array<{ host: string; port: number; message: string }> = [];
      const failed: Array<{ message: string }> = [];
      for (const raw of lines) {
        const parsed = typeof raw === 'string' ? parseLine(raw) : null;
        if (parsed === null) {
          failed.push({ message: 'Expected host:port:user:pass' });
          continue;
        }
        const already = store.homeExits.some((entry) => entry.socks5Host === parsed.host
          && entry.socks5Port === parsed.port
          && entry.socks5Username === parsed.username);
        if (already) {
          skipped.push({ host: parsed.host, port: parsed.port, message: 'already exists' });
          continue;
        }
        const at = nowSec();
        const row: FixtureHomeExit = {
          id: newId(),
          proxyName: `home-socks5-${newId().slice(-8)}`,
          displayName: parsed.notes ?? `Home ${parsed.host}`,
          kind: 'socks5',
          socks5Host: parsed.host,
          socks5Port: parsed.port,
          socks5Username: parsed.username,
          status: 'active',
          bindCount: 0,
          createdAt: at,
          updatedAt: at,
        };
        store.homeExits.push(row);
        created.push(publicExit(row));
      }
      if (created.length > 0) {
        note('home.import', 'home_exit', null, `imported ${String(created.length)}`);
      }
      sendJson(res, { created, skipped, failed }, created.length > 0 ? 201 : 200);
    });
    return true;
  }

  const index = store.homeExits.findIndex((entry) => entry.id === id);
  if (index < 0) {
    sendEmpty(res, 404);
    return true;
  }
  const row = store.homeExits[index];

  if (req.method === 'PATCH') {
    void readBody(req).then((body) => {
      if (typeof body.status === 'string') row.status = body.status;
      if (typeof body.displayName === 'string') row.displayName = body.displayName;
      if (typeof body.notes === 'string') row.notes = body.notes;
      row.updatedAt = nowSec();
      note('home.update', 'home_exit', row.id, row.displayName);
      sendJson(res, { homeExit: publicExit(row) });
    });
    return true;
  }
  if (req.method === 'DELETE') {
    if (store.bindings.some((entry) => entry.homeExitId === row.id)) {
      refuse(sendJson, res, 409, 'HOME_EXIT_IN_USE', 'Unbind all users before deleting this home exit');
      return true;
    }
    store.homeExits.splice(index, 1);
    note('home.delete', 'home_exit', row.id, row.displayName);
    sendEmpty(res, 204);
    return true;
  }
  if (req.method === 'GET') {
    sendJson(res, { homeExit: publicExit(row) });
    return true;
  }
  return false;
}

/** Claim one of the four resources, or hand the request back untouched. */
export function publishRoute(request: PublishRequest): boolean {
  const head = request.parts[0];
  if (head === 'exit-catalog') return catalogRoutes(request);
  if (head === 'catalog-revisions') {
    if (request.req.method !== 'GET') return false;
    const current = request.store.catalog.revision;
    request.sendJson(request.res, {
      revisions: request.store.history.map((row) => ({ ...row, current: row.revision === current })),
    });
    return true;
  }
  if (head === 'traffic-policy') return policyRoutes(request);
  if (head === 'home-exits') return homeExitRoutes(request);
  if (head === 'home-bindings') {
    if (request.req.method !== 'GET') return false;
    request.sendJson(request.res, { bindings: request.store.bindings });
    return true;
  }
  return false;
}
