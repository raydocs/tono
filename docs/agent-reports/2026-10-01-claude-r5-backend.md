# Round-5 backend hunt, 2026-10-01 (Claude)

Scope: `services/control-plane`, `services/exit-agent` and `services/home-agent`. Two parts:

- **Changes since round 1.** Round 1 scanned up to `0676435b`. Since then, three backend PRs merged:
  #1232, #1246 and #1249. #833 was also re-checked, because round 1 only reviewed it after its refresh.
- **Areas not covered before.** Device registration and revocation, session and token refresh,
  per-device VLESS credential issuance, exit node enrolment and token handling, login rate limits,
  and the D1 migrations.

Base: `origin/main` `4bb0ba4a`. Review only: nothing was deployed, there was no remote D1 access, and no wrangler
command ran against remote. Recorded findings and #1273 (catalog PUT admission) were skipped.

## Summary

No P0, P1 or P2 was found, so this round has no fix PR. One P3 needs an owner decision and is filed as #1296.

## Findings

| ID | Severity | File:line | Verdict |
|---|---|---|---|
| R5BE-EXIT-TOKEN-ROTATE-401 | P3 | `src/ops/shared-admin/exit-nodes.ts:87-97`, `src/auth.ts:84-97`, `exit-agent/reconcile_and_report.py:796` | Owner decision, issue #1296. If a token is rotated while the node is **active**, the old token gets 401 rather than 403 `EXIT_NODE_DISABLED`. The agent then fails the round before `reconcile` and leaves the clients already installed in Xray in place. Revocations do not reach that node until the new token is deployed. The disable-then-rotate order is already covered by TF-opus-5 (#638). |

## Review rows

| ID | Verdict | Evidence (current main) |
|---|---|---|
| REG-1232 | ok | `reconcile_and_report.py:1061`: a listing that raises `OSError` or `TimeoutExpired` returns None. Revocation and `withdraw_disabled_node` then fall back to the durable inventory. 118 exit-agent tests pass. |
| REG-1246 | ok | `save_state` fsyncs the file before `replace` and fsyncs the directory after it. A directory-fsync error surfaces only after the state is already in place. The home agent sends the same UA on all three requests. |
| REG-1249 | ok | The `home-exits.ts:327-360` bind order matches the placeholders. The fence applies only when the request takes a new catalog name (a rename, or socks5→catalog). Its predicate matches `HOME_BINDABLE_SQL` (`home.ts:365`). The hy2 suffix was already refused by `assertCatalogHomeProxyName`. Its vitest passes. |
| REG-833 | ok | Same as round 1. Sibling revocation is gated on this request winning the swap (`sessions.ts:36-41`). Logout follows successors and also ends every session on that device (`index.ts:2462-2476`). |

## Areas covered

- **Device revocation → exit credential.** Every revocation path deletes `device_exit_credentials` in the same
  batch, guarded on `status = 'revoked'`. The paths are user DELETE via `revokeDevice` (`index.ts:1592`), LRU rotation (`:1237`), pending
  expiry (`:1094`) and close/enforce through `revokeDevice`. The roster (`index.ts:618`) serves only devices in
  pending or active state, and only for users who are active, unexpired and under quota. Re-signing in on a revoked installation
  mints a new UUID (`:1313`). The legacy per-user UUID is retired by trigger 0077 on any revocation. No path
  leaves a revoked device in the roster.
- **Cross-account mixing.** The catalog UUID is looked up by both `device_id` and `user_id` from the same session
  (`catalog.ts:58-72`). Devices are unique per (`user_id`, `installation_id`). Home SOCKS5 credentials are served only
  to the bound user (`catalog.ts:166-207`). Rebinding a SOCKS5 line someone else held is blocked until its password
  rotates (0080 triggers plus `assertHomeExitBindable`). Diagnostics, log segments and telemetry rows are keyed and
  conflict-guarded by `user_id`.
- **hy2.** The agent's hy2 allowlist is the SHA-256 of the same `clientUUID` per roster entry
  (`reconcile_and_report.py:1580`), and the catalog substitutes one UUID for every block. hy2 is not a second identity.
- **Session refresh.** Grace replay is allowed only for a successor that is live and never rotated. The replay
  revokes the legitimate chain rather than forking it. `auth()` re-checks the session, user and device on every request.
- **Login rate limits.** The figures are per-IP, per-email (normalized to lower case before keying) and
  per-challenge. The OTP guess rate was accepted in round 2 (r2-update-auth item 6), so it is not refiled.
- **Exit node enrolment and token.** Creation and rotation are behind Access with `nodes.publish`. Tokens are
  random and stored only as SHA-256. Disabled and retired nodes answer 403 for both current and revoked hashes. The roster cache is
  created 0600 through `mkstemp`.
- **Secrets in logs.** Control-plane `console.*` calls log only error messages and IDs. The exit agent prints
  counts and labels, never UUIDs. Its error text comes from the Xray CLI and stays on the node.

## D1 migrations

No migration was added or changed after round 1 (`git diff 0676435b origin/main -- migrations` is empty), and
none landed today. Fresh evidence on `4bb0ba4a`, using local SQLite in a scratch directory only:

- All 83 files apply in lexical order with `sqlite3 -bail`, with 0 failures.
- Each file was then re-run against the fully migrated DB. 75 fail loudly on their first statement. The 8 that
  re-run cleanly (`0017`, `0033`, `0057`, `0067`, `0070`, `0071`, `0074`, `0090`) are the same 8 that round 1
  classified as idempotent.

## False-positive log

- An expired pending device stays in the roster until the sweep. The cron sweep (`index.ts:1815`) expires it, and
  production has Tailscale enrolment off, so no pending devices exist.
- Rotating the token of a disabled node loses the withdrawal mark. It does not: `revoked_token_hash` is kept, as TF-opus-5 fixed.
- The roster cache leaks UUIDs to other local users. It does not: it is created owner-only through `mkstemp` plus `fchmod 0600`.
- A diagnostics session id collides across accounts. It cannot: the key is `user_id:sessionId`, and upserts require the same `user_id`.

## Checks

- `npx vitest run test/worker.test.ts -t "fleet-retired node name|refresh|logout|revok"`: 15 passed.
- `python3 -m pytest -q services/exit-agent/test_reconcile_and_report.py`: 118 passed.
- `python3 -m pytest -q` in `services/home-agent`: 26 passed.
- Migration apply and re-run script: 83 applied, 0 failures, 8 clean re-runs.
- Not run: the full control-plane suite. No code changed.
