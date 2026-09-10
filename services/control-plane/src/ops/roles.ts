import { ApiError } from '../errors';
import type { Env } from '../env';
import { can, isOpsRole, type OpsAction, type OpsRole } from './contract';

type OpsV1Route = (typeof import('./handlers/dispatch').OPS_V1_ROUTES)[number];

const ROUTE_ACTIONS: Record<OpsV1Route, OpsAction> = {
  'GET /api/v1/ops/nodes': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}/history': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}/connections': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}/errors': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}/bindings': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}/jobs': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}/acceptance': 'nodes.read',
  'GET /api/v1/ops/nodes/{name}/retire-preview': 'nodes.read',
  'POST /api/v1/ops/nodes/{name}/jobs': 'nodes.jobs',
  'PATCH /api/v1/ops/nodes/{name}/profile': 'nodes.write',
  'GET /api/v1/ops/customers': 'customers.read',
  'GET /api/v1/ops/customers/funnel': 'customers.read',
  'GET /api/v1/ops/customers/{id}': 'customers.read',
  'GET /api/v1/ops/customers/{id}/connections': 'customers.read',
  'GET /api/v1/ops/customers/{id}/activity': 'customers.read',
  'GET /api/v1/ops/customers/{id}/destinations': 'customers.read',
  'GET /api/v1/ops/customers/{id}/services': 'customers.read',
  'GET /api/v1/ops/customers/{id}/followups': 'incidents.read',
  'POST /api/v1/ops/customers/{id}/followups': 'incidents.handle',
  'GET /api/v1/ops/incidents': 'incidents.read',
  'GET /api/v1/ops/incidents/{id}': 'incidents.read',
  'POST /api/v1/ops/incidents/{id}/ack': 'incidents.handle',
  'POST /api/v1/ops/incidents/{id}/snooze': 'incidents.handle',
  'POST /api/v1/ops/incidents/{id}/resolve': 'incidents.handle',
  'POST /api/v1/ops/incidents/{id}/notes': 'incidents.handle',
  'POST /api/v1/ops/incidents/{id}/followups': 'incidents.handle',
  'PATCH /api/v1/ops/incidents/{id}': 'incidents.handle',
  'GET /api/v1/ops/followups': 'incidents.read',
  'PATCH /api/v1/ops/followups/{id}': 'incidents.handle',
  'GET /api/v1/ops/digest': 'incidents.read',
  'GET /api/v1/ops/jobs': 'nodes.read',
  'POST /api/v1/ops/jobs/{id}/cancel': 'nodes.jobs',
  'GET /api/v1/ops/releases': 'releases.read',
  'POST /api/v1/ops/releases': 'releases.write',
  'PATCH /api/v1/ops/releases/{id}': 'releases.write',
  'GET /api/v1/ops/releases/adoption': 'releases.read',
  'GET /api/v1/ops/direct-candidates': 'settings.read',
  'POST /api/v1/ops/direct-candidates/{etld1}/accept': 'settings.publish',
  'POST /api/v1/ops/direct-candidates/{etld1}/reject': 'settings.publish',
  'POST /api/v1/ops/traffic-policy/draft-from-candidates': 'settings.publish',
  'GET /api/v1/ops/provider-accounts': 'settings.read',
  'POST /api/v1/ops/provider-accounts': 'settings.publish',
  'GET /api/v1/ops/provider-accounts/{id}': 'settings.read',
  'PATCH /api/v1/ops/provider-accounts/{id}': 'settings.publish',
  'DELETE /api/v1/ops/provider-accounts/{id}': 'settings.publish',
  'GET /api/v1/ops/home-lines': 'settings.read',
  'POST /api/v1/ops/home-lines': 'settings.publish',
  'GET /api/v1/ops/home-lines/{id}': 'settings.read',
  'PATCH /api/v1/ops/home-lines/{id}': 'settings.publish',
  'DELETE /api/v1/ops/home-lines/{id}': 'settings.publish',
  'GET /api/v1/ops/home-lines/{id}/usage': 'settings.read',
  'GET /api/v1/ops/alert-rules': 'settings.read',
  'POST /api/v1/ops/alert-rules': 'alerts.manage',
  'GET /api/v1/ops/alert-rules/{id}': 'settings.read',
  'PATCH /api/v1/ops/alert-rules/{id}': 'alerts.manage',
  'DELETE /api/v1/ops/alert-rules/{id}': 'alerts.manage',
  'POST /api/v1/ops/alert-rules/{id}/test': 'alerts.manage',
  'GET /api/v1/ops/alert-deliveries': 'settings.read',
  'GET /api/v1/ops/audit': 'audit.read',
  'GET /api/v1/ops/system/health': 'system.read',
  'GET /api/v1/ops/ledger': 'ledger.read',
  'POST /api/v1/ops/ledger': 'ledger.write',
  'PATCH /api/v1/ops/ledger/{id}': 'ledger.write',
  'POST /api/v1/ops/ledger/{id}/reverse': 'ledger.write',
  'GET /api/v1/ops/months/{month}': 'ledger.read',
  'POST /api/v1/ops/months/{month}/close': 'ledger.write',
  'GET /api/v1/ops/months/{month}/export.csv': 'ledger.read',
  'GET /api/v1/ops/fx': 'ledger.read',
};

function patternToRegExp(pattern: string): RegExp {
  const sentinel = '\u0000';
  const withSentinels = pattern.replace(/\{[^/]+\}/g, sentinel);
  const escaped = withSentinels.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replaceAll(sentinel, '([^/]+)')}$`);
}

function routeKey(method: string, routePattern: string): string {
  return `${method} ${routePattern}`;
}

export function actionForRoute(method: string, routePattern: string): OpsAction | null {
  return ROUTE_ACTIONS[routeKey(method, routePattern) as OpsV1Route] ?? null;
}

export function actionForRequest(method: string, path: string): OpsAction | null {
  for (const key of Object.keys(ROUTE_ACTIONS) as OpsV1Route[]) {
    const space = key.indexOf(' ');
    if (key.slice(0, space) !== method) continue;
    if (patternToRegExp(key.slice(space + 1)).test(path)) return ROUTE_ACTIONS[key];
  }
  return null;
}

export function resolveOpsRole(actorEmail: string, e: Env): OpsRole {
  const raw = e.OPS_ROLES;
  if (typeof raw !== 'string' || raw.trim() === '') return 'owner';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('OPS_ROLES ignored');
    return 'owner';
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn('OPS_ROLES ignored');
    return 'owner';
  }
  const email = actorEmail.trim().toLowerCase();
  let found: unknown;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.trim().toLowerCase() === email) {
      found = value;
      break;
    }
  }
  if (found === undefined) return 'owner';
  if (!isOpsRole(found)) {
    console.warn('OPS_ROLES ignored');
    return 'owner';
  }
  return found;
}

export function requireCan(action: OpsAction | null, role: OpsRole): void {
  const allowed = action === null ? role === 'owner' : can(action, role);
  if (!allowed) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'This role cannot perform that action');
  }
}
