/**
 * The single source of truth for the ops console.
 *
 * Both sides of the wire read this file: the Worker's `/api/v1/ops/*` handlers
 * run every response through the `assert*` checkers before it leaves, and the
 * console imports the same types through its `@contract` tsconfig path. There
 * is no code generation and no schema library — two consumers do not justify an
 * OpenAPI pipeline, and a hand-written type that both sides compile against
 * catches the same drift a day earlier.
 *
 * The hard rule that makes that possible: nothing under `src/ops/contract/`
 * imports anything except the shared `errors` module and its own siblings.
 * One `import type { Env }` would pull `@cloudflare/workers-types` into a browser
 * build, and one D1 helper would make the console depend on the Worker's
 * runtime. `tooling/scripts/check-ops-contract-purity.mjs` fails CI over it.
 *
 * Conventions live in docs/ops/api-contract.md. Adding an endpoint means
 * adding a checker here; the route-table coverage test will not let an
 * unchecked one ship.
 */

/**
 * Bumped when a shipped field changes meaning or disappears — additions do
 * not need it. The console sends it back on `system/health` so a stale tab
 * against a newer Worker is visible rather than mysterious.
 */
export const CONTRACT_VERSION = 1;

export * from './contract/vocabulary';
export * from './contract/checkers';
export * from './contract/nodes';
export * from './contract/node-acceptance';
export * from './contract/customers';
export * from './contract/funnel';
export * from './contract/incidents';
export * from './contract/jobs';
export * from './contract/releases';
export * from './contract/alerts';
export * from './contract/followups';
export * from './contract/assets';
export * from './contract/audit';
export * from './contract/system';
export * from './contract/ledger';
export * from './contract/route-table';

// dept:a
// append your entries inside your block

// dept:b
// append your entries inside your block

// dept:c
// append your entries inside your block

// dept:d
// append your entries inside your block

// dept:e
// append your entries inside your block
