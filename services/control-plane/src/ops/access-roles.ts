import type { Env } from '../env';
import type { OpsAction } from './contract';
import { actionForRequest, requireCan, resolveOpsRole } from './roles';
import { sharedAdministrativeResource, type SharedAdminDeps } from './shared-admin';

/** Owner only: irreversible account teardown has no delegated action. */
type Gate = OpsAction | 'owner';

type Entry = readonly [method: string, pattern: RegExp, gate: Gate];

const ID = '[^/]+';
const at = (path: string) => new RegExp(`^${path.replaceAll('{id}', ID)}$`);

/**
 * Every resource `sharedAdministrativeResource` serves, as the Access door
 * sees it (the bearer door is owner-equivalent and not gated).
 */
const SHARED_ADMIN: readonly Entry[] = [
  ['GET', at('usage-metering-rollout'), 'settings.read'],
  ['POST', at('usage-metering-rollout'), 'settings.publish'],
  ['GET', at('users/{id}/devices/{id}/diagnostics-logs'), 'customers.raw-logs'],
  ['PUT', at('users/{id}/devices/{id}/diagnostics-logs'), 'customers.raw-logs'],
  ['DELETE', at('users/{id}/devices/{id}/diagnostics-logs'), 'customers.raw-logs'],
  ['GET', at('diagnostics/logs'), 'customers.raw-logs'],
  ['GET', at('diagnostics/logs/{id}'), 'customers.raw-logs'],
  ['GET', at('exit-nodes'), 'nodes.read'],
  ['POST', at('exit-nodes'), 'nodes.publish'],
  ['POST', at('exit-nodes/{id}/token'), 'nodes.publish'],
  ['PATCH', at('exit-nodes/{id}'), 'nodes.publish'],
  ['GET', at('exit-credential-rollout'), 'nodes.read'],
  ['POST', at('exit-credential-rollout'), 'nodes.publish'],
  ['GET', at('home-exits'), 'settings.read'],
  ['POST', at('home-exits'), 'settings.publish'],
  ['POST', at('home-exits/assign'), 'settings.publish'],
  ['POST', at('home-exits/import'), 'settings.publish'],
  ['GET', at('home-exits/{id}/probes'), 'settings.read'],
  ['PATCH', at('home-exits/{id}'), 'settings.publish'],
  ['DELETE', at('home-exits/{id}'), 'settings.publish'],
  ['GET', at('home-bindings'), 'settings.read'],
  ['GET', at('users/{id}/home-binding'), 'customers.read'],
  ['PUT', at('users/{id}/home-binding'), 'customers.write'],
  ['DELETE', at('users/{id}/home-binding'), 'customers.write'],
  ['POST', at('users/{id}/close'), 'owner'],
  ['POST', at('signup-allowlist'), 'customers.write'],
  ['GET', at('exit-catalog'), 'settings.read'],
  ['PUT', at('exit-catalog'), 'settings.publish'],
  ['GET', at('traffic-policy'), 'settings.read'],
  ['PUT', at('traffic-policy'), 'settings.publish'],
  ['GET', at('device-actions'), 'customers.read'],
  ['POST', at('device-actions'), 'customers.write'],
  ['GET', at('devices'), 'customers.read'],
  ['DELETE', at('devices/{id}'), 'customers.write'],
  ['GET', at('product-accounts'), 'settings.read'],
  ['POST', at('product-accounts'), 'settings.publish'],
  ['POST', at('product-accounts/{id}/ban'), 'settings.publish'],
  ['POST', at('product-accounts/{id}/replace'), 'settings.publish'],
  ['GET', at('product-accounts/{id}'), 'settings.read'],
  ['GET', at('node-profiles'), 'nodes.read'],
  ['POST', at('node-profiles'), 'nodes.write'],
  ['PUT', at('node-profiles/{id}'), 'nodes.write'],
  ['GET', at('audit'), 'audit.read'],
  ['GET', at('hy2-auto-switch'), 'settings.read'],
  ['PUT', at('hy2-auto-switch'), 'settings.publish'],
  ['GET', at('users/{id}/hy2-auto-switch'), 'customers.read'],
  ['PUT', at('users/{id}/hy2-auto-switch'), 'customers.write'],
];

/** Legacy routes `opsRoutes` answers before the v1 dispatcher gets a look. */
const LEGACY: readonly Entry[] = [
  ['GET', at('dashboard'), 'system.read'],
  ['GET', at('system/version'), 'system.read'],
  ['GET', at('fleet-nodes'), 'nodes.read'],
  ['GET', at('fleet-nodes/{id}/retire-preview'), 'nodes.read'],
  ['GET', at('fleet-nodes/{id}/quality-text'), 'nodes.read'],
  ['GET', at('catalog-revisions'), 'settings.read'],
  ['GET', at('users'), 'customers.read'],
  ['GET', at('signup-allowlist'), 'customers.read'],
  ['GET', at('live'), 'nodes.read'],
  ['GET', at('metrics'), 'nodes.read'],
  ['GET', at('usage-hours'), 'customers.read'],
  ['GET', at('activity'), 'customers.read'],
  ['GET', at('users/{id}/detail'), 'customers.read'],
  ['GET', at('incidents/node/{id}'), 'incidents.read'],
  ['POST', at('fleet-nodes/{id}/retire'), 'nodes.retire'],
  ['DELETE', at('signup-allowlist'), 'customers.write'],
  ['PATCH', at('signup-allowlist/{id}'), 'customers.write'],
  ['POST', at('users/onboard'), 'customers.write'],
  ['PATCH', at('users/{id}'), 'customers.write'],
];

function find(table: readonly Entry[], method: string, resource: string): Gate | undefined {
  return table.find(([m, pattern]) => m === method && pattern.test(resource))?.[2];
}

/**
 * Shared-admin and legacy routes are gated from the tables above; v1 routes
 * are gated by `dispatchOpsV1`. A path none of them knows is owner-only, so a
 * shared-admin resource added without a row here fails closed.
 */
export function accessGate(method: string, resource: string): Gate | null {
  const gate = find(SHARED_ADMIN, method, resource) ?? find(LEGACY, method, resource);
  if (gate) return gate;
  return actionForRequest(method, `/api/v1/ops/${resource}`) ? null : 'owner';
}

/** The Access door onto shared-admin: authorize, then serve. */
export async function accessSharedResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string,
  deps: SharedAdminDeps,
): Promise<Response | null> {
  const gate = accessGate(m, resource);
  if (gate) requireCan(gate === 'owner' ? null : gate, resolveOpsRole(actorEmail, e));
  return sharedAdministrativeResource(req, e, resource, m, actorEmail, deps);
}
