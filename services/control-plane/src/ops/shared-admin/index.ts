import {
  type Env,
  type Row,
} from '../../env';
import {
  publicAction,
  publicDevice,
  deviceActionsResource,
} from './device-actions';
import {
  USAGE_METERING_LEGACY_QUIET_SECONDS,
  USAGE_METERING_NODE_READY_SECONDS,
  usageMeteringStatus,
  usageMeteringResource,
} from './usage-metering';
import {
  backfillDeviceExitCredentials,
  exitNodesResource,
} from './exit-nodes';
import { diagnosticsLogsResource } from './diagnostics-logs';
import { homeExitsResource } from './home-exits';
import { catalogResource } from './catalog';
import { trafficPolicyResource } from './traffic-policy';
import { productAccountsResource } from './product-accounts';
import { auditResource } from './audit';

export {
  publicAction,
  publicDevice,
};
export {
  USAGE_METERING_LEGACY_QUIET_SECONDS,
  USAGE_METERING_NODE_READY_SECONDS,
  usageMeteringStatus,
};
export {
  backfillDeviceExitCredentials,
};

export type SharedAdminDeps = {
  revokeDevice: (e: Env, d: Row, requireIneligibleUser?: boolean) => Promise<void>;
  processRevocations: (e: Env) => Promise<void>;
  enforceUser: (e: Env, userId: string, processNow?: boolean) => Promise<void>;
  publicAdministrativeAction: (row: Row) => ReturnType<typeof publicAction>;
};

/**
 * Resources served identically to both administrative front doors.
 *
 * The operations console authenticates with Cloudflare Access and the scripted
 * surface with a bearer token, but home exits, their bindings and the signup
 * allowlist are the same resource either way — and each was implemented twice,
 * byte for byte, about 260 lines of it. That is not a tidiness problem: a fix to
 * one copy leaves the other wrong. The two had already begun to diverge — the
 * allowlist listing coerced `email` on one path and not the other, harmless in
 * itself because D1 returns a string for a TEXT column either way, but it is
 * divergence appearing in code nobody had touched deliberately.
 * `directSuffixes` shipping with no syntax validation at all came from this
 * same shape, and that one was not harmless.
 *
 * Returns null when the resource is not one of the shared ones, so each caller
 * still reaches the handlers that genuinely are its own — `/ops/dashboard`,
 * `/admin/traffic-policy`, and the two `users` listings, which return
 * deliberately different shapes and are not merged.
 *
 * Authentication is the caller's responsibility and must already have happened:
 * this performs no authorization of its own.
 */
export async function sharedAdministrativeResource(
  req: Request,
  e: Env,
  resource: string,
  m: string,
  actorEmail: string | undefined,
  deps: SharedAdminDeps,
): Promise<Response | null> {
  const usage = await usageMeteringResource(req, e, resource, m, actorEmail);
  if (usage) return usage;
  const diagnostics = await diagnosticsLogsResource(req, e, resource, m, actorEmail);
  if (diagnostics) return diagnostics;
  const exits = await exitNodesResource(req, e, resource, m, actorEmail);
  if (exits) return exits;
  const homes = await homeExitsResource(req, e, resource, m, actorEmail);
  if (homes) return homes;
  const catalog = await catalogResource(req, e, resource, m, actorEmail, deps);
  if (catalog) return catalog;
  const traffic = await trafficPolicyResource(req, e, resource, m, actorEmail);
  if (traffic) return traffic;
  const devices = await deviceActionsResource(req, e, resource, m, actorEmail, deps);
  if (devices) return devices;
  const products = await productAccountsResource(req, e, resource, m, actorEmail);
  if (products) return products;
  const audit = await auditResource(req, e, resource, m);
  if (audit) return audit;
  return null;
}
