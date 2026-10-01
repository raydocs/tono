## 2026-09-30 · Which ops role may use the shared-admin and legacy routes (H4-F3)?

- Status: provisional
- Chosen: the gate reuses the existing action vocabulary. Catalog, routing, home-exit inventory,
  usage-metering and product-account writes need `settings.publish` (owner). Exit-node create, token and
  PATCH, plus the credential rollout, need `nodes.publish` (owner). Every diagnostics-log route, including
  the per-device window, needs `customers.raw-logs` (owner). `users/{id}/close` is owner-only. Device
  actions, home bindings and `POST signup-allowlist` need `customers.write`. A path that no table knows is
  owner-only. Rejected: letting an operator edit home-exit inventory, which would need a new action, and
  letting 404 stand in for unknown paths.
- Why stricter: an operator or viewer loses writes they could reach before. An unset `OPS_ROLES`
  (production today) still resolves everyone to owner, so current use does not change.
- Applied in: branch `cursor/ops-role-gate-shared-admin-d728`, `services/control-plane/src/ops/access-roles.ts` ([#716](https://github.com/raydocs/tono/pull/716)).
