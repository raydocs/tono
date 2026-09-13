import { sha256 } from '../crypto';
import { clientIp } from '../auth';
import { ApiError } from '../errors';
import {
  type Env,
  type Row,
} from '../env';
import {
  type SharedAdminDeps,
} from './shared-admin';
import type { OpsRequestCache } from './cache';
import {
  operationsCatalogRevisions,
} from './reads';
import { dispatchOpsV1, OPS_V1_ROUTES } from './handlers/dispatch';
import { getSystemPulse } from './handlers/system';
import { getOpsDashboard } from './legacy-handlers/dashboard';
import { getOpsSystemVersion } from './legacy-handlers/system';
import {
  getOpsFleetNodes,
  getOpsFleetNodeRetirePreview,
  getOpsFleetNodeQualityText,
  postOpsFleetNodeRetire,
} from './legacy-handlers/fleet-nodes';
import {
  getOpsUsers,
  getOpsUserHomeBinding,
  getOpsUserDetail,
  postOpsUserOnboard,
  patchOpsUser,
} from './legacy-handlers/users';
import {
  getOpsSignupAllowlist,
  deleteOpsSignupAllowlist,
  patchOpsSignupAllowlist,
} from './legacy-handlers/signup-allowlist';
import { getOpsLive } from './legacy-handlers/live';
import { getOpsMetrics } from './legacy-handlers/metrics';
import { getOpsUsageHours } from './legacy-handlers/usage-hours';
import { getOpsActivity } from './legacy-handlers/activity';
import { getOpsIncidentNode } from './legacy-handlers/incidents-node';
import { requireCan, resolveOpsRole } from './roles';

export { OPS_V1_ROUTES };

export async function publicSystemRoute(
  req: Request,
  e: Env,
  p: string,
  m: string,
  deps: {
    buildSha: (e: Env) => string;
    consumeRateLimit: (e: Env, key: string, limit: number, windowSeconds: number) => Promise<void>;
  },
): Promise<Response | null> {
  if (m !== 'GET') return null;
  if (p === '/api/v1/system/version') {
    return Response.json({ service: 'api', version: '0.0.1', buildSha: deps.buildSha(e) });
  }
  if (p === '/api/v1/system/pulse') {
    await deps.consumeRateLimit(e, `rl:${await sha256(`system-pulse:ip:${clientIp(req)}`)}`, 60, 3600);
    return getSystemPulse(e, deps.buildSha(e));
  }
  return null;
}

export type OpsRouterDeps = {
  buildSha: (e: Env) => string;
  freshestProtectedRouteProof: (
    action: Row | null | undefined,
    telemetry: Row | null | undefined,
  ) => unknown;
  enforceUser: (e: Env, userId: string, processNow?: boolean) => Promise<void>;
  sharedAdminDeps: SharedAdminDeps;
};

export async function opsRoutes(
  req: Request,
  e: Env,
  p: string,
  m: string,
  actor: { email: string },
  ctx: ExecutionContext,
  deps: OpsRouterDeps,
): Promise<Response | null> {
  const opsCache: OpsRequestCache = {};

  let mt: RegExpMatchArray | null;

  // dept:E
  const role = resolveOpsRole(actor.email, e);
  const gated = { ...actor, role };

  // --- Product ops reads (Cloudflare Access) ---
  if (m === 'GET') {
    if (p === '/api/v1/ops/dashboard') {
      return getOpsDashboard(e, opsCache);
    }
    if (p === '/api/v1/ops/system/version') {
      return getOpsSystemVersion(e, deps);
    }
    if (p === '/api/v1/ops/fleet-nodes') {
      return getOpsFleetNodes(e, opsCache);
    }
    mt = p.match(/^\/api\/v1\/ops\/fleet-nodes\/([^/]+)\/retire-preview$/);
    if (mt) {
      return getOpsFleetNodeRetirePreview(e, mt, opsCache);
    }
    mt = p.match(/^\/api\/v1\/ops\/fleet-nodes\/([^/]+)\/quality-text$/);
    if (mt) {
      return getOpsFleetNodeQualityText(e, mt);
    }
    if (p === '/api/v1/ops/catalog-revisions') {
      return Response.json({ revisions: await operationsCatalogRevisions(e) });
    }
    if (p === '/api/v1/ops/users') {
      return getOpsUsers(req, e);
    }
    if (p === '/api/v1/ops/signup-allowlist') {
      return getOpsSignupAllowlist(e);
    }
    if (p === '/api/v1/ops/live') {
      return getOpsLive(e, opsCache);
    }
    if (p === '/api/v1/ops/metrics') {
      return getOpsMetrics(req, e);
    }
    if (p === '/api/v1/ops/usage-hours') {
      return getOpsUsageHours(req, e);
    }
    if (p === '/api/v1/ops/activity') {
      return getOpsActivity(e, opsCache);
    }
    mt = p.match(/^\/api\/v1\/ops\/users\/([^/]+)\/home-binding$/);
    if (mt) {
      return getOpsUserHomeBinding(e, mt);
    }
    mt = p.match(/^\/api\/v1\/ops\/users\/([^/]+)\/detail$/);
    if (mt) {
      return getOpsUserDetail(e, mt, deps);
    }
    mt = p.match(/^\/api\/v1\/ops\/incidents\/node\/([^/]+)$/);
    if (mt) {
      return getOpsIncidentNode(e, mt, opsCache);
    }
    const v1Get = await dispatchOpsV1(req, e, p, m, gated);
    if (v1Get) return v1Get;
    throw new ApiError(404, 'NOT_FOUND', 'Route not found');
  }

  mt = p.match(/^\/api\/v1\/ops\/fleet-nodes\/([^/]+)\/retire$/);
  if (mt && m === 'POST') {
    // dept:E
    requireCan('nodes.retire', role);
    return postOpsFleetNodeRetire(req, e, actor, mt, opsCache);
  }

  // --- Product ops writes (same Access boundary; no ADMIN_API_TOKEN in browser) ---
  if (p === '/api/v1/ops/signup-allowlist' && m === 'DELETE') {
    // dept:E
    requireCan('customers.write', role);
    return deleteOpsSignupAllowlist(req, e, actor);
  }
  mt = p.match(/^\/api\/v1\/ops\/signup-allowlist\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    return patchOpsSignupAllowlist(req, e, actor, mt);
  }
  if (p === '/api/v1/ops/users/onboard' && m === 'POST') {
    // dept:E
    requireCan('customers.write', role);
    return postOpsUserOnboard(req, e, actor, deps);
  }
  mt = p.match(/^\/api\/v1\/ops\/users\/([^/]+)$/);
  if (mt && m === 'PATCH') {
    // dept:E
    requireCan('customers.write', role);
    return patchOpsUser(req, e, actor, mt, deps);
  }

  const v1Write = await dispatchOpsV1(req, e, p, m, gated);
  if (v1Write) return v1Write;
  return null;
}
