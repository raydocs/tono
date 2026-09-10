import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AlertDeliveryDto,
  AlertRuleDto,
  AuditEntryDto,
  DirectCandidateDto,
  HomeLineDto,
  HomeLineUsageDayDto,
  ListDto,
  ProviderAccountDto,
} from '@contract';
import { nowSec } from '../../src/lib/clock';
import { materializeOps } from '../../src/lib/ops-fixtures';
import { createPublishStore, publishRoute, type PublishStore } from './settings-publish';

/**
 * The 设置 half of the fixture dev server.
 *
 * Six resources, all of them writable, all of them served out of the captured
 * preview responses in `fixtures/captured/normal/`. It is a mutable store per
 * `?session=` for the same reason the incident store is one: a drawer that
 * saves a rule and then refetches is only a test of anything if the refetch
 * can come back changed, and one shared copy would let the screenshot suite
 * and the write tests edit each other's data.
 *
 * The seed is the captured JSON rather than hand-written rows so the shapes
 * here cannot drift from what the Worker actually sends — the same files the
 * contract checkers run over in `test/captured-fixtures.test.ts`.
 */

/** The clock the captured set was frozen at; `index.json` is the record of it. */
type CapturedIndex = { freezeNow: number };

type Store = {
  alertRules: AlertRuleDto[];
  deliveries: AlertDeliveryDto[];
  providers: ProviderAccountDto[];
  homeLines: HomeLineDto[];
  usage: HomeLineUsageDayDto[];
  candidates: DirectCandidateDto[];
  audit: AuditEntryDto[];
  /** 注册白名单: who may open an account without being onboarded. */
  allowlist: AllowedEmail[];
  /** The catalogue, the routing rules and the home inventory; see the sibling file. */
  publish: PublishStore;
};

/** The shape `GET signup-allowlist` returns one of per entry. */
type AllowedEmail = { email: string; createdAt: number };

/** Two addresses somebody added by hand before a launch; the rest come from 开通. */
function seedAllowlist(clock: number): AllowedEmail[] {
  return [
    { email: 'carol@example.test', createdAt: clock - 6 * 86_400 },
    { email: 'dave@example.test', createdAt: clock - 2 * 86_400 },
  ];
}

type Request = {
  req: IncomingMessage;
  res: ServerResponse;
  /** The path after `/api/v1/ops/`, already split and decoded. */
  parts: string[];
  query: URLSearchParams;
  session: string;
  empty: boolean;
};

const AUDIT_PAGE = 50;

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  res.end();
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    let raw = '';
    req.on('data', (chunk) => { raw += String(chunk); });
    req.on('end', () => {
      try {
        done(JSON.parse(raw || '{}') as Record<string, unknown>);
      } catch {
        done({});
      }
    });
  });
}

/** The list envelope every collection endpoint returns, stamped with the newest row. */
function listOf<T>(items: T[], stamp: (row: T) => number): ListDto<T> {
  const stamps = items.map(stamp);
  return {
    items,
    nextCursor: null,
    total: items.length,
    updatedAt: stamps.length === 0 ? nowSec() : Math.max(...stamps),
  };
}

let counter = 0;

/** Ids look like the Worker's so a fixture row and a real one read the same. */
function newId(): string {
  counter += 1;
  return `id_fixture${String(counter).padStart(10, '0')}`;
}

export function createSettingsFixtures(rootDir: string) {
  const dir = path.resolve(rootDir, 'fixtures/captured/normal');
  const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T;
  const clock = read<CapturedIndex>('index.json').freezeNow;
  /** Captured epochs move to the frozen clock, so "3 分钟前" stays true. */
  const shift = <T>(body: T): T => materializeOps(body, clock);

  const stores = new Map<string, Store>();

  function storeFor(session: string, empty: boolean): Store {
    const key = `${session}/${empty ? 'empty' : 'normal'}`;
    const found = stores.get(key);
    if (found) return found;
    const made: Store = empty
      ? {
        alertRules: [], deliveries: [], providers: [],
        homeLines: [], usage: [], candidates: [], audit: [], allowlist: [],
        publish: createPublishStore(true),
      }
      : {
        alertRules: shift(read<ListDto<AlertRuleDto>>('alert-rules.json')).items,
        deliveries: shift(read<ListDto<AlertDeliveryDto>>('alert-deliveries.json')).items,
        providers: shift(read<ListDto<ProviderAccountDto>>('provider-accounts.json')).items,
        homeLines: shift(read<ListDto<HomeLineDto>>('home-lines.json')).items,
        usage: shift(read<ListDto<HomeLineUsageDayDto>>('home-lines-id-usage.json')).items,
        candidates: shift(read<{ items: DirectCandidateDto[] }>('direct-candidates.json')).items
          // `firstSeen` does not end in `At`, so the shared shifter leaves it
          // where it was captured; without this the inbox says 两年前.
          .map((row) => ({ ...row, firstSeen: row.firstSeen + (nowSec() - clock) })),
        audit: shift(read<{ entries: AuditEntryDto[] }>('audit.json')).entries,
        allowlist: seedAllowlist(nowSec()),
        publish: createPublishStore(false),
      };
    stores.set(key, made);
    return made;
  }

  /**
   * Every write leaves a line behind, exactly as the Worker's `auditWrite`
   * does. Without it 操作记录 would be a page that never changes no matter what
   * the operator did on the other five.
   */
  function note(store: Store, action: string, targetType: string, targetId: string | null, summary: string): void {
    store.audit.unshift({
      id: newId(),
      at: nowSec(),
      actorEmail: 'owner@example.test',
      actorType: 'access_admin',
      actorRole: null,
      action,
      targetType,
      targetId,
      summary,
      requestId: null,
    });
  }

  function alertRules({ req, res, parts, store }: Request & { store: Store }): boolean {
    const [, id, action] = parts;
    if (id === undefined) {
      if (req.method === 'GET') {
        sendJson(res, listOf(store.alertRules, (row) => row.updatedAt));
        return true;
      }
      if (req.method !== 'POST') return false;
      void readBody(req).then((body) => {
        const at = nowSec();
        const rule: AlertRuleDto = {
          id: newId(),
          name: String(body.name ?? ''),
          enabled: body.enabled !== false,
          matchKind: (body.matchKind as string | null) ?? null,
          matchSubjectType: (body.matchSubjectType as string | null) ?? null,
          matchSubjectId: (body.matchSubjectId as string | null) ?? null,
          minSeverity: (body.minSeverity as AlertRuleDto['minSeverity']) ?? 'warn',
          minImpact: Number(body.minImpact ?? 0),
          fireOn: (body.fireOn as AlertRuleDto['fireOn']) ?? 'open',
          delaySeconds: Number(body.delaySeconds ?? 0),
          cooldownSeconds: Number(body.cooldownSeconds ?? 3_600),
          channel: (body.channel as AlertRuleDto['channel']) ?? 'webhook',
          target: String(body.target ?? ''),
          template: (body.template as AlertRuleDto['template']) ?? 'generic',
          secretRef: (body.secretRef as string | null) ?? null,
          lastFiredAt: null,
          createdAt: at,
          updatedAt: at,
        };
        store.alertRules.push(rule);
        note(store, 'alert-rule.create', 'alert_rule', rule.id, rule.name);
        sendJson(res, rule, 201);
      });
      return true;
    }

    const index = store.alertRules.findIndex((row) => row.id === id);
    if (index < 0) {
      sendEmpty(res, 404);
      return true;
    }
    const rule = store.alertRules[index];

    if (action === 'test' && req.method === 'POST') {
      const at = nowSec();
      rule.lastFiredAt = at;
      rule.updatedAt = at;
      store.deliveries.unshift({
        id: newId(),
        ruleId: rule.id,
        incidentId: null,
        dedupeKey: `${rule.id}:test`,
        transition: 'test',
        status: 'pending',
        channel: rule.channel,
        target: rule.target,
        attempts: 0,
        error: null,
        at,
        deliveredAt: null,
      });
      note(store, 'alert-rule.test', 'alert_rule', rule.id, rule.name);
      sendJson(res, rule);
      return true;
    }
    if (action !== undefined) return false;

    if (req.method === 'GET') {
      sendJson(res, rule);
      return true;
    }
    if (req.method === 'DELETE') {
      store.alertRules.splice(index, 1);
      note(store, 'alert-rule.delete', 'alert_rule', rule.id, rule.name);
      sendEmpty(res, 204);
      return true;
    }
    if (req.method !== 'PATCH') return false;
    void readBody(req).then((body) => {
      Object.assign(rule, body, { id: rule.id, updatedAt: nowSec() });
      note(store, 'alert-rule.update', 'alert_rule', rule.id, rule.name);
      sendJson(res, rule);
    });
    return true;
  }

  function providers({ req, res, parts, store }: Request & { store: Store }): boolean {
    const [, id] = parts;
    if (id === undefined) {
      if (req.method === 'GET') {
        sendJson(res, listOf(store.providers, (row) => row.updatedAt));
        return true;
      }
      if (req.method !== 'POST') return false;
      void readBody(req).then((body) => {
        const at = nowSec();
        const row: ProviderAccountDto = {
          id: newId(),
          provider: String(body.provider ?? ''),
          label: String(body.label ?? ''),
          cloudKind: (body.cloudKind as ProviderAccountDto['cloudKind']) ?? 'vps',
          loginEmailMasked: maskEmail(body.loginEmail),
          billingUrl: (body.billingUrl as string | null) ?? null,
          balanceHint: (body.balanceHint as string | null) ?? null,
          renewNotes: (body.renewNotes as string | null) ?? null,
          secretRef: (body.secretRef as string | null) ?? null,
          nodeCount: 0,
          createdAt: at,
          updatedAt: at,
        };
        store.providers.push(row);
        note(store, 'provider-account.create', 'provider_account', row.id, row.label);
        sendJson(res, row, 201);
      });
      return true;
    }

    const index = store.providers.findIndex((row) => row.id === id);
    if (index < 0) {
      sendEmpty(res, 404);
      return true;
    }
    const row = store.providers[index];

    if (req.method === 'GET') {
      sendJson(res, row);
      return true;
    }
    if (req.method === 'DELETE') {
      store.providers.splice(index, 1);
      note(store, 'provider-account.close', 'provider_account', row.id, row.label);
      sendJson(res, row);
      return true;
    }
    if (req.method !== 'PATCH') return false;
    void readBody(req).then((body) => {
      const { loginEmail, ...rest } = body;
      Object.assign(row, rest, { id: row.id, updatedAt: nowSec() });
      if (loginEmail !== undefined) row.loginEmailMasked = maskEmail(loginEmail);
      note(store, 'provider-account.update', 'provider_account', row.id, row.label);
      sendJson(res, row);
    });
    return true;
  }

  function homeLines({ req, res, parts, store }: Request & { store: Store }): boolean {
    const [, id, section] = parts;
    if (id === undefined) {
      if (req.method === 'GET') {
        sendJson(res, listOf(store.homeLines, (row) => row.updatedAt));
        return true;
      }
      if (req.method !== 'POST') return false;
      void readBody(req).then((body) => {
        const at = nowSec();
        const row: HomeLineDto = {
          id: newId(),
          proxyName: String(body.proxyName ?? ''),
          displayName: String(body.displayName ?? ''),
          status: 'active',
          isp: (body.isp as string | null) ?? null,
          region: (body.region as string | null) ?? null,
          providerAccountId: (body.providerAccountId as string | null) ?? null,
          price: (body.price as number | null) ?? null,
          currency: (body.currency as string | null) ?? null,
          billingKind: (body.billingKind as HomeLineDto['billingKind']) ?? null,
          bundleBytes: (body.bundleBytes as number | null) ?? null,
          cycleStart: (body.cycleStart as number | null) ?? null,
          cycleEnd: (body.cycleEnd as number | null) ?? null,
          expiresAt: (body.expiresAt as number | null) ?? null,
          meterSource: (body.meterSource as HomeLineDto['meterSource']) ?? null,
          usage: { value: null, asOfSec: null, source: 'manual' },
          probe: { value: null, asOfSec: null, source: 'collector' },
          boundUsers: { value: 0, asOfSec: at, source: 'manual' },
          notes: (body.notes as string | null) ?? null,
          createdAt: at,
          updatedAt: at,
        };
        store.homeLines.push(row);
        note(store, 'home-line.create', 'home_exit', row.id, row.displayName);
        sendJson(res, row, 201);
      });
      return true;
    }

    const index = store.homeLines.findIndex((row) => row.id === id);
    if (index < 0) {
      sendEmpty(res, 404);
      return true;
    }
    const row = store.homeLines[index];

    if (section === 'usage') {
      if (req.method !== 'GET') return false;
      sendJson(res, listOf(store.usage, (row) => row.dayAt));
      return true;
    }
    if (section !== undefined) return false;

    if (req.method === 'GET') {
      sendJson(res, row);
      return true;
    }
    if (req.method === 'DELETE') {
      row.status = 'retired';
      row.updatedAt = nowSec();
      note(store, 'home-line.retire', 'home_exit', row.id, row.displayName);
      sendJson(res, row);
      return true;
    }
    if (req.method !== 'PATCH') return false;
    void readBody(req).then((body) => {
      Object.assign(row, body, { id: row.id, proxyName: row.proxyName, updatedAt: nowSec() });
      note(store, 'home-line.update', 'home_exit', row.id, row.displayName);
      sendJson(res, row);
    });
    return true;
  }

  function candidates({ req, res, parts, query, store }: Request & { store: Store }): boolean {
    const [, host, action] = parts;
    if (host === undefined) {
      if (req.method !== 'GET') return false;
      const status = query.get('status');
      const rows = status ? store.candidates.filter((row) => row.status === status) : store.candidates;
      sendJson(res, listOf(rows, (row) => row.decidedAt ?? row.firstSeen));
      return true;
    }
    if (req.method !== 'POST' || (action !== 'accept' && action !== 'reject')) return false;
    const row = store.candidates.find((entry) => entry.etld1 === host);
    if (!row) {
      sendEmpty(res, 404);
      return true;
    }
    row.status = action === 'accept' ? 'accepted' : 'rejected';
    row.decidedBy = 'owner@example.test';
    row.decidedAt = nowSec();
    note(store, `direct-candidate.${action}`, 'direct_candidate', row.etld1, row.status);
    sendJson(res, row);
    return true;
  }

  /** The draft the Worker would canonicalise, minus the publish it never does. */
  function draft({ req, res, parts, store }: Request & { store: Store }): boolean {
    if (req.method !== 'POST' || parts[1] !== 'draft-from-candidates') return false;
    const accepted = store.candidates.filter((row) => row.status === 'accepted');
    note(store, 'traffic-policy.draft-from-candidates', 'traffic_policy', null, `${accepted.length} accepted`);
    sendJson(res, {
      draft: {
        version: 4,
        domains: [],
        mediaEndpoints: [],
        webDomains: [],
        directSuffixes: accepted
          .map((row) => ({ host: row.etld1.toLowerCase(), ports: [443] }))
          .sort((a, b) => a.host.localeCompare(b.host)),
        tcpEndpoints: [],
      },
      note: 'draft only; not published',
    });
    return true;
  }

  /**
   * 注册白名单, all three verbs.
   *
   * The POST inserts or ignores exactly as the hub does — 201 for a new
   * address, 200 for one that was already there — because that difference is
   * the whole reason the section says which of the two happened rather than
   * showing one confirmation for both. The DELETE takes its address in the
   * body, not in the path, which is why the console cannot reach it through
   * the shared `deleteJson`.
   */
  function allowlist({ req, res, store }: Request & { store: Store }): boolean {
    if (req.method === 'GET') {
      const rows = [...store.allowlist]
        .sort((a, b) => (b.createdAt - a.createdAt) || a.email.localeCompare(b.email));
      sendJson(res, { entries: rows });
      return true;
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') return false;
    const method = req.method;
    void readBody(req).then((body) => {
      const address = String(body.email ?? '').trim().toLowerCase();
      if (address === '' || !address.includes('@')) {
        sendJson(res, { error: { code: 'VALIDATION_ERROR', message: address } }, 400);
        return;
      }
      if (method === 'DELETE') {
        const at = store.allowlist.findIndex((row) => row.email === address);
        if (at >= 0) {
          store.allowlist.splice(at, 1);
          note(store, 'allowlist.remove', 'signup_allowlist', address, address);
        }
        sendEmpty(res, 204);
        return;
      }
      const found = store.allowlist.find((row) => row.email === address);
      if (found) {
        sendJson(res, { ...found, created: false });
        return;
      }
      const row = { email: address, createdAt: nowSec() };
      store.allowlist.push(row);
      note(store, 'allowlist.add', 'signup_allowlist', address, address);
      sendJson(res, { ...row, created: true }, 201);
    });
    return true;
  }

  function deliveries({ req, res, store }: Request & { store: Store }): boolean {
    if (req.method !== 'GET') return false;
    sendJson(res, listOf(store.deliveries, (row) => row.at));
    return true;
  }

  function audit({ req, res, query, store }: Request & { store: Store }): boolean {
    if (req.method !== 'GET') return false;
    const targetId = query.get('targetId');
    const actorEmail = query.get('actorEmail');
    const before = query.get('before') === null ? null : Number(query.get('before'));
    const beforeId = query.get('beforeId');
    const limit = query.get('limit') === null ? AUDIT_PAGE : Number(query.get('limit'));
    const rows = [...store.audit]
      .sort((a, b) => (b.at - a.at) || b.id.localeCompare(a.id))
      .filter((row) => (targetId === null || row.targetId === targetId))
      .filter((row) => (actorEmail === null || row.actorEmail === actorEmail))
      .filter((row) => {
        if (before === null) return true;
        if (row.at < before) return true;
        return beforeId !== null && row.at === before && row.id < beforeId;
      });
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page.length === 0 ? null : page[page.length - 1];
    sendJson(res, {
      entries: page,
      hasMore,
      nextBefore: hasMore && last ? last.at : null,
      nextBeforeId: hasMore && last ? last.id : null,
    });
    return true;
  }

  /** The four resources `settings-publish.ts` owns, plus the rules document. */
  const PUBLISH_RESOURCES = new Set([
    'exit-catalog', 'catalog-revisions', 'traffic-policy', 'home-exits', 'home-bindings',
  ]);

  const HANDLERS: Record<string, (request: Request & { store: Store }) => boolean> = {
    'alert-rules': alertRules,
    'alert-deliveries': deliveries,
    'provider-accounts': providers,
    'home-lines': homeLines,
    'direct-candidates': candidates,
    'signup-allowlist': allowlist,
    'traffic-policy': draft,
    audit,
  };

  /**
   * Claim the request, or hand it back. Returning `false` leaves the response
   * untouched so the caller's own 404 still describes the route.
   */
  function settingsFixtures(options: {
    req: IncomingMessage;
    res: ServerResponse;
    route: string;
    url: string;
    session: string;
    empty: boolean;
  }): boolean {
    const parts = options.route.split('/').map(decodeURIComponent);
    const handler = HANDLERS[parts[0]];
    const publishes = PUBLISH_RESOURCES.has(parts[0]);
    // Claim the route before building anything: a store is seven files read and
    // re-stamped, and every 今天 and 客户 request comes through here too.
    if (!handler && !publishes) return false;
    const query = new URLSearchParams(options.url.split('?')[1] ?? '');
    const store = storeFor(options.session, options.empty);
    // The publishing resources go first; they hand back anything they do not
    // own, including `traffic-policy/draft-from-candidates`, which belongs to
    // 直连候选 rather than to the rules editor.
    if (publishes && publishRoute({
      req: options.req,
      res: options.res,
      parts,
      query,
      store: store.publish,
      note: (action, targetType, targetId, summary) => note(store, action, targetType, targetId, summary),
      sendJson,
      sendEmpty,
      readBody,
      newId,
    })) {
      return true;
    }
    if (!handler) return false;
    return handler({
      req: options.req,
      res: options.res,
      parts,
      query,
      session: options.session,
      empty: options.empty,
      store,
    });
  }

  /**
   * Take an address off the sign-up list from outside this module.
   *
   * 撤销开通 on the 客户 page sends the same DELETE this section does, and the
   * funnel fixtures answer it — they own the invited row. This is the other
   * half of that write: without it 注册白名单 would go on listing an address
   * that can no longer sign up, and the two pages would disagree about who is
   * allowed in.
   */
  settingsFixtures.removeAllowlisted = (session: string, empty: boolean, email: string): void => {
    const store = storeFor(session, empty);
    const at = store.allowlist.findIndex((row) => row.email === email);
    if (at < 0) return;
    store.allowlist.splice(at, 1);
    note(store, 'allowlist.remove', 'signup_allowlist', email, email);
  };

  return settingsFixtures;
}

/** The Worker masks on the way in; the fixture has to, or the drawer lies. */
function maskEmail(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') return null;
  const at = text.indexOf('@');
  if (at <= 0) return `${text.slice(0, 1)}***`;
  return `${text.slice(0, 1)}***${text.slice(at)}`;
}
