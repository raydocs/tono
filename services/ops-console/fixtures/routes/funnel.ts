import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FunnelDto, FunnelRowDto } from '@contract';
import { materializeOps } from '../../src/lib/ops-fixtures';
import { readBody, refuse, sendEmpty, sendJson } from './customers-store';

/**
 * 开通漏斗 and the two writes that change it, served by the fixture dev server.
 *
 * The store is mutable per `?session=` like the incident and customer ones,
 * and for the same reason: a handle typed into the invite drawer that the next
 * read does not carry, or a revoked invitation the table still lists, proves
 * nothing about the page. Both writes go through the sign-up list, because
 * that row is all an invited person has — there is no customer record to patch
 * until they have logged in from a client.
 *
 * The DELETE is the one the 设置 · 注册白名单 section already sends, so this
 * module removes the address from that section's store as well through
 * `alsoRemove`. Two lists that disagree about who may sign up is exactly the
 * kind of split-brain the fixtures exist to catch in the real hub.
 */

type FunnelFile = { clock: number; funnel: FunnelDto };

type Store = {
  clock: number;
  stages: FunnelDto['stages'];
  items: FunnelRowDto[];
  updatedAt: number;
};

function fileName(empty: boolean, dense: boolean): string {
  if (empty) return 'funnel.empty.json';
  return dense ? 'funnel.dense.json' : 'funnel.json';
}

export function createFunnelFixtures(
  rootDir: string,
  alsoRemove: (session: string, empty: boolean, email: string) => void,
) {
  const stores = new Map<string, Store>();

  function storeFor(session: string, empty: boolean, dense: boolean): Store | null {
    const name = fileName(empty, dense);
    const key = `${session}/${name}`;
    const found = stores.get(key);
    if (found) return found;
    let file: FunnelFile;
    try {
      file = JSON.parse(readFileSync(path.resolve(rootDir, 'fixtures', name), 'utf8')) as FunnelFile;
    } catch {
      return null;
    }
    const made: Store = {
      clock: file.clock,
      stages: file.funnel.stages,
      items: file.funnel.items,
      updatedAt: file.funnel.updatedAt,
    };
    stores.set(key, made);
    return made;
  }

  /** The counts follow the rows: a revoked invitation leaves the segment too. */
  function body(store: Store): FunnelDto {
    return {
      stages: store.stages.map((row) => (row.stage === 'connected' ? row : {
        stage: row.stage,
        count: store.items.filter((item) => item.stage === row.stage).length,
      })),
      items: store.items,
      updatedAt: store.updatedAt,
    };
  }

  return function funnelFixtures(options: {
    req: IncomingMessage;
    res: ServerResponse;
    route: string;
    session: string;
    empty: boolean;
    dense: boolean;
  }): boolean {
    const parts = options.route.split('/').map(decodeURIComponent);
    const method = options.req.method ?? 'GET';
    const reads = parts[0] === 'customers' && parts[1] === 'funnel' && parts.length === 2;
    const writes = parts[0] === 'signup-allowlist'
      && ((method === 'PATCH' && parts.length === 2) || (method === 'DELETE' && parts.length === 1));
    if (!reads && !writes) return false;

    const store = storeFor(options.session, options.empty, options.dense);
    if (store === null) {
      refuse(options.res, 500, 'UPSTREAM', options.route);
      return true;
    }

    if (reads) {
      if (method !== 'GET') return false;
      sendJson(options.res, materializeOps(body(store), store.clock));
      return true;
    }

    if (method === 'PATCH') {
      const email = parts[1].trim().toLowerCase();
      const row = store.items.find((item) => item.email.toLowerCase() === email);
      if (!row) {
        refuse(options.res, 404, 'NOT_FOUND', email);
        return true;
      }
      void readBody(options.req).then((patch) => {
        for (const field of ['wechatId', 'contact', 'notes'] as const) {
          const value = patch[field];
          if (typeof value === 'string') row[field] = value.trim() === '' ? null : value.trim();
          else if (value === null) row[field] = null;
        }
        sendJson(options.res, materializeOps(row, store.clock));
      });
      return true;
    }

    void readBody(options.req).then((patch) => {
      const email = String(patch.email ?? '').trim().toLowerCase();
      if (email === '' || !email.includes('@')) {
        refuse(options.res, 400, 'VALIDATION_ERROR', email);
        return;
      }
      const at = store.items.findIndex((item) => (
        item.userId === null && item.email.toLowerCase() === email
      ));
      if (at >= 0) store.items.splice(at, 1);
      alsoRemove(options.session, options.empty, email);
      sendEmpty(options.res, 204);
    });
    return true;
  };
}
