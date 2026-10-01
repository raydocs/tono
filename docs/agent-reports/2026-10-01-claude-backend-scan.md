# Backend regression and exit-agent scan, 2026-10-01 (Claude)

Scope: slot R4-RegLate limited to the backend (`services/control-plane`, `services/ops-console`,
`services/exit-agent`, `services/home-agent`, `ops-panel`, D1 migrations). It covers every PR merged
from 2026-10-01T04:45Z to 10:05Z, the R4-ExitAgent deep scan, and a D1 migration audit. Base:
`origin/main` `0676435b`. The PR list was refreshed at 10:05Z and four new merges were added
(#833, #1212, #1218, #1224). This was review only; nothing was deployed and nothing touched remote D1.

## Summary

| Area | PRs / items | Regressions | New findings | Fix PRs | Issues |
|---|---|---|---|---|---|
| Control plane: retirement, relist, home binding, account close | 6 | 0 | 0 (1 admin-only P3 concern) | none | none |
| Control plane: ledger, keys, policy, quota; ops-console | 9 | 0 | 0 | none (#1212 already fixed the sibling) | none |
| Exit agent and home agent | 3 merged + deep scan | 0 | CBS-XA-01 (P2), 2 × P3 | #1232 | #1233 |
| Late merges after the refresh | 4 | 0 | 0 | none | none |
| D1 migrations | 83 files | none | none | none | none |
| Records | 21 fragments + 1 ledger row | n/a | stale `in-PR` status | this PR | none |

No P0 or P1 found, so none is left unfixed.

## Regression rows (REG-&lt;PR&gt;)

| ID | Verdict | Evidence (current main) |
|---|---|---|
| REG-1065 | ok | `services/exit-agent/reconcile_and_report.py:1534`: a validation timeout becomes a deferred refusal. The inventory is saved and the ACK and metering still run first. |
| REG-1080 | ok | `fleet.ts:270` and `jobs-worker.ts:107` pass the retirement revision to `revokeExitToken` (`retire-dependencies.ts:146`). Relist refuses a non-active exit (`fleet.ts:384`). If an unrelated revision bump skips the revoke, the cron drain sweep (`retire-dependencies.ts:218`) revokes it on the next tick. |
| REG-1083 | ok | `assertCatalogHomeUnbound` runs in `operationsRetirePreview` (`fleet.ts:166`), which covers the HTTP route, the job and job replay. It checks both the base name and the ` · hy2` name. |
| REG-1084 | ok | AI blocking only gets stricter. Control plane (`traffic-policy.ts:239`), macOS and Windows carry the same four DashScope suffixes and the same `aliyuncs.com` carve-out. The helper contract hash on main recomputes to the recorded value. Not checked: the Windows sing-box half (another session owns it). |
| REG-1091 | ok | `ops/handlers/ledger.ts:154`: the page ETag includes a hash of the rows on the page. |
| REG-1096 | ok | `ops/ledger.ts:321`: export sign follows the CNY amount. A zero-CNY reversal chain takes its sign from the parity walk (`handlers/ledger.ts:370`). The console comment `api-ledger.ts:52` ("Never both") is stale; comment only. |
| REG-1167 | ok | `catalog_relist` params are only checked when present (`jobs.ts:216`). The SPKI pin follows the block name (`catalog-yaml.ts:806`). There is no relist route that bypasses the job. |
| REG-1170 | ok | Two fences cover both commit orders: bind requires the home to be active and its profile not retired (`home.ts:365`), and retirement requires no binding (`fleet.ts:235`). ` · hy2` names are refused first (`home.ts:346`). |
| REG-1176 | ok | `oidc.ts:99`: a JWKS body that fails mid-read returns 503, and the challenge is not used up. |
| REG-1180 | ok | `exit-identity-roster.ts:38` sends this node's per-user watermarks. The agent checks them against the identities (`:616`), and they can only raise totals (`:1307`). |
| REG-1183 | ok | `ops-timeseries.ts:132`: SQLite evaluates `SET` against the old row, so a complete counter pair survives a partial reading in the same minute. It covers node host metrics only and has no path into per-user billing. |
| REG-1186 | ok | Close picks the current assigned account inside its own transaction (`shared-admin/catalog.ts:74`). The unique index `product_accounts_one_assigned` allows only one. |
| REG-1189 | ok | Quality charts use UTC days. Its siblings (node errors, home-line usage) were the same bug as #1200, fixed by #1212 (below). |
| REG-1190 | ok | `access.ts:112`: same as #1176 for Access keys. It is a separate module, so the two don't interact. |
| REG-1194 | ok | `customer-board.ts:36`: expired customers count as overdue, and are still left out of active load and usage. |
| REG-1203 | ok | Every write that sets a home to `retired` is guarded against bindings (`assets.ts:321`, `home-lines.ts:223`, `home-exits.ts:206`, `:330`). The shared-admin DELETE relies on the FK `RESTRICT`. |
| REG-1206 | ok | `reconcile_and_report.py:1314`: the accounting-only `u:<user>` carry never enters the installed inventory, hy2 or revocation. A later counter starts from baseline 0. |
| REG-1208 | ok | `App.tsx:139` is keyed by customer ID. |
| REG-833 | ok | `sessions.ts`: sibling revocation on the same device runs in the same batch as the rotation and only when this request won the swap. The grace replay rotates the successor and excludes it, and other devices stay signed in. Only the app process refreshes (macOS `TonoAPIClient`, Windows `tono-core::auth`), so it does not revoke a second legitimate chain on the same device. |
| REG-1212 | ok | Node error and home-line usage bars use `formatUtcDate`. Real timestamps stay in local time. |
| REG-1218 | ok | `quota.ts` `rollNodeCycle` reads counters after the open cycle and admits them with a compare-and-set. A reading that loses the race still applies the profile quota. When the profile path has no counters, it still opens a cycle without a sample. |
| REG-1224 | ok | `telemetry-window.ts`: `error`/`reason`/`probe`/`from`/`to` are redacted with `redactJobResult` before storing and flattening. `from`/`to` hold node names, and no consumer parses addresses out of them. Its own limit stands: a window near 64 KiB can grow past the cap and get a 413. |

Mutation check (retirement cluster): removing each fence on main one at a time (#1080 direct path and
job path, #1083, #1170 retire side and bind side, #1203 DELETE, #1186) made that PR's regression test
fail. Each fence was restored afterwards.

## New findings

| ID | Severity | State | Evidence |
|---|---|---|---|
| CBS-XA-01 | P2 | fix in #1232 (auto-merge) | `reconcile_and_report.py:1061` `installed_clients`: if the listing CLI raises `TimeoutExpired` or `OSError`, the error escapes callers that catch only `Refusal`. The round exits before revocation, and `withdraw_disabled_node` exits before removing anything. The fix treats the listing as unknown (None), so removal falls back to the durable inventory. The test fails on the old code. |
| exit-agent state rename without fsync | P3 | #1233 | `reconcile_and_report.py:737` `save_state`. After a crash at the wrong moment the state can be empty. Metering then refuses until an operator clears it; revocation still runs. |
| home-agent default urllib User-Agent | P3, latent | #1233 | `services/home-agent/report_example.py:319,532,554`. The exit agent notes that Cloudflare answers the default UA with 403/1010. The home agent is not deployed. |
| shared-admin home PATCH rename past the #1170 fence | P3, concern | not filed | `home-exits.ts:280+` can rename a bound catalog home's `proxyName` to a fleet-retired node's name. It takes an admin mistake and predates tonight. |

## D1 migrations (`services/control-plane/migrations`)

- **Ordering.** There are 83 SQL files. Prefixes are reused only at `0016`, `0017` and `0018`, all documented
  in the migrations README and older than tonight. No PR merged tonight adds or renames a migration.
  The numbering gaps (0058–0066, 0083–0087, 0089) are harmless because wrangler applies by name, in lexical order. The old names
  of renamed files (`0072_ops_change_receipts`, `0077_*`, `0080_exit_node_revoked_token`,
  `0037_revocation_retry_fairness`) never appear in main's first-parent history, so production cannot hold
  a pre-rename row for them. The open PRs touch no migrations.
- **Clean apply.** `wrangler d1 migrations apply DB --local --persist-to <scratch>` with a scratch config (local only)
  applied all 83 files without error. Re-running it reported "No migrations to apply".
- **Re-run safety.** Each file was executed a second time against the fully migrated DB with
  `sqlite3 -bail`. 75 fail loudly on the first statement (`already exists` or `duplicate column`), so nothing
  applies twice. The 8 that re-run without error are all idempotent:
  - `0033` is a retention `DELETE`.
  - `0067` seeds with `INSERT OR IGNORE`.
  - `0017` and `0057` rebuild a table by copying it.
  - `0070`, `0071`, `0074` and `0090` are DDL with `IF [NOT] EXISTS`.
- **Code against schema.** Every string-literal SQL passed to `.prepare()` in `src/` and `admin/` was compiled
  against the migrated schema with `node:sqlite`: 702 statements, 0 failures. 44 more were skipped because
  their SQL is not a literal or interpolates an identifier. Control run: on a schema without `0092`/`0093`,
  the same check failed 32 statements, so it does detect code that runs ahead of its migration. Deployment
  order is safe too: `tooling/scripts/deploy-control-plane-main.sh` applies migrations and exits before
  either Worker deploys if they fail.
- Minor doc gap: the migrations README index stops at `0091` and lacks `0092`/`0093`.

## Records fixed in this PR

These PRs merged, but their findings rows still said `in-PR`. They now say `fixed` and link the merged PR,
keeping any issue link: TELEMETRY-FREE-TEXT-IDENTIFIERS (#1224), R4CPC-QUOTA-STALE-SAMPLE (#1218),
OPS-ERRORS-HOME-UTC-DATES (#1212), R4FCP-CUSTOMER-SUBJECT (#1208), R4FCP-EMPTY-COUNTER-CARRY (#1206),
R4FCP-HOME-INVENTORY-RETIRE (#1203), R4FCP-OVERDUE-CUSTOMER-COUNTS (#1194), R4CPC-ACCESS-BODY-UNAVAILABLE (#1190),
R4FCP-QUALITY-UTC-DATES (#1189), R4CPC-CLOSE-REPLACEMENT (#1186), R4CPC-QUOTA-MINUTE-PAIR (#1183),
R4FCP-INACTIVE-RECOVERY-WATERMARK (#1180), R4CPC-OIDC-BODY-UNAVAILABLE (#1176), R4FCP-HOME-BIND-RETIRE (#1170),
R4FMC-CP-RELIST-SPKI (#1167), R4CP-LEDGER-NESTED-REVERSAL (#1096), R4CP-LEDGER-PAGE-VALIDATOR (#1091),
MAC-DASHSCOPE-DIRECT-COVERAGE (#1084), R4SW-CP-BOUND-HOME-RETIRE (#1083), R4CP-RETIRE-RELIST-FENCE (#1080),
R4CP-RETIRE-VALIDATION-TIMEOUT (#1065), and the ledger row H17-G-F5 (#833).

## False-positive log

- A bad roster wipes every client: validation and the node-ID check run before anything changes.
- #1180 watermarks above local totals in normal running: the server total is never above the local total.
- Double count when the Xray restart marker changes: a missing marker falls back to comparing counters, which can only under-count.
- Usage replay or roster-ACK failure skipping the counter fold: deliberate ordering, already known as E1-ACK-RESTART-LOSS (needs two failures).
- Bisect loop on 400s without backoff: the server rejects whole batches, and the dropped figure is re-sent next round.
- #1206 placeholder against a legacy `u:<user>` counter: its baseline is 0, so only new bytes are added.
- #1167 param schema rejecting relist jobs that send no params: its guards only check keys that are present.
- #1186's single event ID with several assigned accounts: a unique index allows only one.
- #1083 and #1170 disagreeing on ` · hy2` names: `catalogHy2Name` gives the same result for either input.
- Drain sweep revoking while a catalog home is still bound: only possible with bindings that predate #1083, or the admin rename above.
- #1084 helper version or contract hash damaged by a rebase: the recomputed hash matches.
- Node detail page keeping the old node's state like #1208 did: its form resets when the node changes.
- #833 revoking a second legitimate refresh chain on the same device: only the app refreshes on each platform.
- #1224 breaking telemetry idempotency: canonicalization is deterministic, and no client-side hash covers the raw text.

## Checks

- control-plane: `npm ci` and `npm run typecheck` pass. `npx vitest run` passes for these files:
  - `test/ops-jobs.test.ts`: 26
  - `test/ops-api.test.ts`: 51
  - `test/ops-ledger.test.ts` + `test/ops-timeseries.test.ts`: 46
  - worker, ops-timeseries, ops-exit-asns and ops-quota together: 234
  - the four new worker regressions from #1176/#1190/#1186/#1183: 4
- exit-agent: `python3 -m unittest` passes 117 tests, including #1232's new test, which fails on the old code.
- home-agent: `python3 -m unittest` passes 25 tests.
- ops-console: vitest on `customer-board`, `App` and both Quality test files: 7 pass.
- D1: local apply of all 83 migrations, the re-run probe and the schema check, as above.
- Not run: Swift, Windows Rust, live Xray or systemd on a node, and anything against production.
