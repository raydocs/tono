export const OPS_ROLES = ['viewer', 'operator', 'owner'] as const;
export type OpsRole = (typeof OPS_ROLES)[number];

export const OPS_ACTIONS = [
  'system.read', 'audit.read',
  'incidents.read', 'incidents.handle',          // ack / snooze / close / follow-ups
  'nodes.read', 'nodes.write',                   // profile edits, rename
  'nodes.publish', 'nodes.retire', 'nodes.jobs', // 上架/下架, retire, node jobs
  'customers.read', 'customers.write',           // onboard / patch / allowlist
  'customers.raw-logs',                          // diagnostics log access window + reading segments
  'ledger.read', 'ledger.write',
  'releases.read', 'releases.write',
  'settings.read', 'settings.publish',           // catalog / routing / home inventory publish
  'alerts.manage',
] as const;
export type OpsAction = (typeof OPS_ACTIONS)[number];

// A viewer watches the fleet and the customers; 设置 (publishing, money,
// alert rules, provider accounts) is not theirs to read.
const VIEWER_ACTIONS = [
  'system.read',
  'incidents.read',
  'nodes.read',
  'customers.read',
  'releases.read',
] as const satisfies readonly OpsAction[];

const OPERATOR_ACTIONS = [
  ...VIEWER_ACTIONS,
  'settings.read',
  'incidents.handle',
  'nodes.write',
  'nodes.jobs',
  'customers.write',
  'releases.write',
  'audit.read',
] as const satisfies readonly OpsAction[];

const GRANTS: Record<OpsRole, readonly OpsAction[]> = {
  viewer: VIEWER_ACTIONS,
  operator: OPERATOR_ACTIONS,
  owner: OPS_ACTIONS,
};

export function can(action: OpsAction, role: OpsRole): boolean {
  return GRANTS[role].includes(action);
}

export function isOpsRole(value: unknown): value is OpsRole {
  return typeof value === 'string' && (OPS_ROLES as readonly string[]).includes(value);
}
