## YOUR AREAS (slot W1-sol-cp; branch prefix `hunt/sol-cp-`)
Only Grok has reviewed these (broad and shallow), or nobody has. You are the second, deep pass.
- **C5**: `services/control-plane/src/{catalog,catalog-yaml,home,env,admin-worker,retention,signup-profile,http,errors}.ts`, `src/releases/host.ts`.
  - Catalog identity invariants (` · hy2` is a second block on the same node, never a second identity); signed catalog/policy generation; retention deleting live data.
- **C6**: `src/telemetry/*.ts`, `diagnostics-limits.ts`, `ops-timeseries.ts`.
  - Unbounded inputs, PII in stored diagnostics, and 500s.
- **C7a**: `src/ops/{router,http,roles,token-admin,shared-admin,platform}.ts`, `src/ops/shared-admin/*`, `src/ops/legacy-handlers/*`.
  - AUTHZ: every route must enforce the right role. Check IDOR across customers, token scope, CSRF on state-changing routes.
- **C7b**: `src/ops/{ledger,ledger-recon,fx,customers*,customers-device,change-receipts,node-identity,home-lines,assets,retire-dependencies}.ts`, `src/ops/handlers/*`, `src/ops/contract/*`.
  - Money and ledger correctness: rounding, currency, reversal/idempotency, double-apply on retry.
- **C8**: `services/control-plane/migrations/*` (84 D1 migrations), `tooling/scripts/wipe-d1-in-order.mjs`, `tooling/scripts/restore-control-plane-d1-preview.sh`.
  - Migration ordering and idempotency, missing indexes on hot unique paths, constraint mismatches with the code, data loss in table rebuilds, FK/cascade surprises.
- **C9**: `services/control-plane/admin/*`, `public/*`, `preview/*`.

Also check D1 concurrency: read-modify-write without a conditional UPDATE, ON CONFLICT clauses that do not reset columns, and batch vs non-batch atomicity.
In-flight: #713 #716 #734, plus codex2 cp-logout-refresh-race. `services/ops-console` UI is not yours.
Local checks: `cd services/control-plane && npm ci && npm run typecheck && npm test`.
