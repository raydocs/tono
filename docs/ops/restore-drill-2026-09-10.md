# Restore drill — 2026-09-10

Backup object: `tono-releases/backups/control-plane-d1/20260910T085207Z.sql.gz`
Target: preview D1 `tono-control-plane-ops-preview` (`12c01ca6-d170-4fcf-9ee1-062256562c46`)
Run from: `/Users/ruirui/orca/workspaces/tono/spookfish`, wrangler 4.129.0, active profile `tono`
Production `tono-control-plane`: never written. One read-only cross-check query against it was
attempted and blocked by the session's permission classifier; it was not retried and is not needed —
the dump's own row counts are the comparison (below).

**Verdict: the backup restores and the restored database works as data.** Two things the drill
turned up are worth acting on: today's object has no `.sha256` sidecar (so the repo's own restore
script would refuse it), and wiping a populated D1 is much harder than the docs assume.

---

## Timings (wall clock, per step)

| Step | Seconds |
| --- | --- |
| 1a. R2 `object get` (6,250,853 B) | 1 |
| 1b. sha256 verify | <1 |
| 1c. gunzip → 92,864,267 B / 181,818 lines | <1 |
| 1d. fetch `.sha256` sidecar | 1 (**failed — key does not exist**) |
| 2a. wipe preview DB (6 wrangler calls incl. 4 failures + 2 probes) | ~38 |
| 2b. import dump | **28** (server-side SQL 17.2 s) |
| 2c. `d1 migrations apply` | 3 |
| 3. verification battery (17 queries) | ~22 |
| **Total wrangler time** | **~1 min 35 s** |

End-to-end including diagnosis of the wipe failures: about 18 minutes.

---

## 1. Fetch and verify

```sh
npx --prefix services/control-plane wrangler r2 object get \
  tono-releases/backups/control-plane-d1/20260910T085207Z.sql.gz \
  --file <scratchpad>/20260910T085207Z.sql.gz --remote
shasum -a 256 <scratchpad>/20260910T085207Z.sql.gz
gunzip -c <scratchpad>/20260910T085207Z.sql.gz > <scratchpad>/restore-drill.sql
```

- sha256 `13d3024181d99d59ad680c285baf2d3a973084b14603fdd8de9a181011713037` — **matches** the
  expected value in the brief.
- Uncompressed: 92,864,267 bytes, 181,818 lines, 77 `CREATE TABLE`, 0 `DROP`, 62 `d1_migrations` rows.

### Deviation 1 — the `.sha256` sidecar is missing

```sh
npx … r2 object get tono-releases/backups/control-plane-d1/20260910T085207Z.sql.gz.sha256 …
# ✘ The specified key does not exist.
npx … r2 object get tono-releases/backups/control-plane-d1/2026-09-10T08:52:07Z.sql.gz.sha256 …
# ✘ The specified key does not exist.
```

`tooling/scripts/backup-control-plane-d1.sh` stamps objects `%Y-%m-%dT%H:%M:%SZ` — i.e.
`2026-09-10T08:52:07Z.sql.gz` — and always uploads a sidecar next to them. Today's object is named
`20260910T085207Z.sql.gz` (compact, no separators) and has no sidecar, so it was **not** produced by
the nightly script or workflow; it is the manual pre-deploy dump recorded in
`docs/ops/rollout-ops2.md` §0.1.

Consequence: **`tooling/scripts/restore-control-plane-d1-preview.sh` cannot restore today's backup.**
It downloads `$key.sha256` and `fail`s hard if the get fails, before any import. The drill therefore
had to be done by hand. `docs/ops/d1-backups.md` §"季度恢复演练清单" step 1 explicitly says to check
that the object *and* its `.sha256` are both present — for this object that check fails.

---

## 2. Restore

### 2a. Wiping the preview database — four failures before it worked

`docs/ops/rollout-ops2.md` §1 does not actually wipe: the 2026-09-10 rehearsal imported into a
*freshly created* preview DB. `docs/ops/d1-backups.md` says the same thing more bluntly ("演练前先
删掉并重建 preview 自己的 D1"). The brief forbids creating databases, so the existing preview (77
tables, 97 indexes, 21 triggers left over from that rehearsal) had to be emptied in place. The dump
has no `DROP` statements and uses `CREATE TABLE IF NOT EXISTS`, so importing over it would have
collided on every primary key.

What failed, in order:

1. `d1 execute --file wipe.sql` (`PRAGMA defer_foreign_keys=TRUE` + 194 drops) → `{"D1_RESET_DO":true}`,
   7 s. Database unchanged (wrangler rolled back, as its own message promises).
2. Same file, retried → `not authorized: SQLITE_AUTH`, 2 s. Cause: the drop list included D1's
   internal table `_cf_KV`, which the D1 authorizer refuses.
3. Corrected file (193 drops, `_cf_%` excluded) → `{"D1_RESET_DO":true}`, 6 s.
4. Same corrected file, retried → `{"D1_RESET_DO":true}`, 4 s.

Diagnosis (probes, not guesses):

- `PRAGMA defer_foreign_keys=TRUE` alone: accepted. A single `DROP TRIGGER`: accepted. So neither the
  pragma nor the drops are individually rejected.
- Running the drops in small `--command` batches surfaced the real error the file path was hiding:
  `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER) [code: 7500]`
  when dropping a parent table (`exit_nodes`, `home_exits`, …) while children still referenced it.
- `PRAGMA foreign_keys=OFF; PRAGMA foreign_keys;` → reads back `1`. **D1 will not let you disable
  foreign keys**, and `defer_foreign_keys` does not survive across statements in a `--command` batch,
  so the pragma trick in the dump's own header does not help a drop script.

What worked: drop triggers → indexes → then tables **in dependency order**, children first, computed
by parsing `REFERENCES` out of `sqlite_master.sql` and topologically sorting. 58 remaining tables,
10 per `--command`, 8 s, no errors.

```sh
# schema inventory
npx --prefix services/control-plane wrangler d1 execute tono-control-plane-ops-preview \
  --remote --json -y --command "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
# … generate drops in dependency order, then per chunk:
npx --prefix services/control-plane wrangler d1 execute tono-control-plane-ops-preview \
  --remote -y --command "DROP TABLE IF EXISTS \"sessions\"; DROP TABLE IF EXISTS \"devices\"; …"
```

After the wipe `sqlite_master` held exactly `_cf_KV` and `sqlite_sequence`.

**This is the drill's most useful finding:** there is no tested way to reset a populated D1 in this
repo. The documented path is "delete the database and make a new one", which changes the
`database_id` and so is not a path production could take. Anyone restoring over a live D1 will hit
exactly these four errors.

### 2b. Import

```sh
npx --prefix services/control-plane wrangler d1 execute tono-control-plane-ops-preview \
  --remote -y --file <scratchpad>/restore-drill.sql
```

28 s wall, 17,219 ms server SQL time, first attempt. `rows_written: 721917`, `changes: 180657`,
`num_tables: 77`, database size after 65.88 MB.

### 2c. Migrations

```sh
npx --prefix services/control-plane wrangler d1 migrations apply tono-control-plane-ops-preview \
  --remote --config services/control-plane/wrangler.preview.jsonc
```

### Deviation 2 — `migrations apply` needs a config file

Run without `--config` from the repo root it fails with `No configuration file found. Create a
wrangler.jsonc file to define your D1 database.` — unlike `d1 execute`, the migrations command
resolves `migrations_dir` from a config, and there is no `wrangler.jsonc` at the repo root. Passing
the local (gitignored) `wrangler.preview.jsonc` by absolute-ish path, exactly as
`docs/ops/rollout-ops2.md` §1 prescribes, works and does not hit the profile/auth bug the brief
warned about. (`-y` is also rejected — `Unknown argument: y`; `migrations apply` skips confirmation
non-interactively instead.)

### Deviation 3 — three migrations were pending, not none

The brief expected "none pending because the dump already carries 0053–0055". It did not. The dump's
`d1_migrations` ends at `0052_ops_device_status.sql` (62 rows), and the dump contains no
`ops_ledger_entries` / `ops_fx_rates` / `ops_month_close` at all. Output:

```
0053_ops_ledger.sql               ✅
0054_users_wechat_id.sql          ✅
0055_signup_allowlist_profile.sql ✅
🚣 Executed 5 commands in 12.49ms
```

The 08:52:07Z dump is the **pre-deploy** backup taken before the ninth deploy (`aa240b8`), which is
the deploy that applied 0053–0055. So the backup predates them by design. All three applied cleanly
on top of restored production data — which is itself a useful result: it is the same rehearsal
`rollout-ops2.md` §1 asks for, and it passed.

---

## 3. Does the restored database work as data?

### Counts (restored preview vs. INSERT counts in the dump)

| Thing | Restored | In dump | Match |
| --- | --- | --- | --- |
| `users` | 20 | 20 | ✅ |
| `devices` | 27 | 27 | ✅ |
| `exit_nodes` total / `status='active'` | 0 / 0 | 0 | ✅ (see note) |
| `managed_exit_catalog` revision | 48 (`updated_at` 1789024696, sha `a2pWGIh_…`) | — | ✅ single row |
| `ops_node_status` | 18 | 18 | ✅ |
| `ops_incidents` open (`status <> 'resolved'`) | 11 (52 total) | 52 | ✅ |
| `ops_fx_rates` for `2026-09-10` | 0 (0 total) | table absent | expected — table created by 0053 |
| `ops_ledger_entries` | 0 | table absent | expected — table created by 0053 |
| `telemetry_windows` | 7,533 | 7,533 | ✅ |
| `sessions` | 370 | — | ✅ |
| `exit_credentials` / `operations_servers` / `home_exits` | 19 / 16 / 9 | — | ✅ |

Note on `exit_nodes`: zero is faithful, not a restore failure — the dump contains zero
`INSERT INTO "exit_nodes"` rows. "Exit nodes with active tokens" is therefore 0 in production too;
the fleet is carried by `exit_credentials` (19), `operations_servers` (16) and `home_exits` (9).

Freshness: `max(telemetry_windows.received_at)` = 1789029984 = **2026-09-10 08:46:24 UTC**, six
minutes before the 08:52:07Z dump. The restore carries data right up to the backup instant.

Schema after restore + migrations: **80 tables, 104 indexes, 21 triggers** (77 tables from the dump
plus the three from 0053; the triggers from 0035/0037 that the code depends on are all present).

### Integrity

### Deviation 4 — `PRAGMA integrity_check` is not available on D1

```
PRAGMA integrity_check     → not authorized: SQLITE_AUTH [code: 7500]
PRAGMA integrity_check(1)  → not authorized: SQLITE_AUTH [code: 7500]
PRAGMA quick_check         → "ok"          (420 ms)
PRAGMA foreign_key_check   → []            (no violations)
```

D1's authorizer refuses `integrity_check`. `quick_check` is allowed and returns `ok`; combined with
an empty `foreign_key_check` that is the strongest integrity statement the platform permits. Worth
correcting in the drill checklist, since `integrity_check` will never pass on D1.

### `d1_migrations` vs. the migrations directory

### Deviation 5 — the table is a superset: 5 applied migrations have no file in the repo

- `d1_migrations`: 65 rows (62 restored + 3 just applied), last `0055_signup_allowlist_profile.sql`.
- `services/control-plane/migrations/`: 60 `.sql` files.
- Every one of the 60 repo files is recorded as applied — nothing is missing, so `migrations apply`
  is correct to report the branch as fully applied.
- Five recorded names have **no file in the repo and no reference anywhere in
  `services/control-plane/src`**:

  ```
  0026_diagnostics_failure_index.sql
  0027_diagnostics_log_failures.sql
  0028_destination_stats.sql
  0029_destination_flow_stats.sql
  0030_destination_blocked_route.sql
  ```

  The repo's 0026–0030 are entirely different migrations (`0026_node_profile_billing.sql`,
  `0027_activity_device_recent.sql`, …), and `git log -M` shows no rename that would explain it. The
  numbers were reused. The tables those five created — `diagnostics_failure_index`,
  `diagnostics_log_failures`, `destination_stats`, `destination_flow_stats` — do exist in the dump and
  in the restore, but nothing in the current Worker reads or writes them.

  Two consequences. (a) They are dead weight carried in every backup. (b) A restore into a *brand new*
  empty D1 built from `migrations/` alone would not create them and would not have those five rows —
  so a schema-only rebuild and a dump-based restore do not produce the same database. Harmless today
  because no code touches them; worth deciding whether to drop the tables or re-add the files, so the
  two paths converge.

### A query the console actually runs

`getCustomers` in `services/control-plane/src/ops/handlers/customers.ts` — its list query, its
incident lookup, its device-count fill, and the per-customer `customerStatus` read from
`services/control-plane/src/ops/customers-read.ts`:

| Query (as in the handler) | Result |
| --- | --- |
| `SELECT * FROM users ORDER BY email ASC, id ASC` | 20 rows, 19 `status='active'`, `wechat_id` column present, all NULL |
| `SELECT subject_id, kind, title FROM ops_incidents WHERE subject_type='user' AND status <> 'resolved' AND kind IN ('customer-repeat-fail','customer-path-slow','customer-switch-churn')` | 1 row |
| `SELECT user_id, COUNT(*) AS n FROM devices GROUP BY user_id` | 18 groups, 27 devices |
| `SELECT * FROM ops_customer_status WHERE user_id = ?` (first user by email) | 1 row |
| `SELECT DISTINCT family FROM service_usage_daily WHERE user_id = ? AND day_at >= ?` | 0 rows — `service_usage_daily` is empty in production too (0 rows total), not a restore gap |
| `SELECT count(*), sum(connected) FROM ops_customer_status` | 12 rows, 7 connected |

The customer list renders: 20 customers, 18 of them with devices, one carrying an open incident,
`wechat_id` readable because 0054 applied. `signup_allowlist` has 17 rows and now carries the
`wechat_id` / `contact` / `notes` columns from 0055 (all NULL — they postdate the dump).

---

## 4. What a real restore into production would additionally need

D1 is the only thing backed up. Restoring it gets accounts, devices, catalog *ciphertext*, telemetry
and ops projections back, and nothing else. Missing pieces, from
`tooling/scripts/backup-control-plane-d1.sh`, `services/control-plane/wrangler.jsonc` and
`docs/ops/rollout-ops2.md`:

**Worker secrets — none are in any backup.** `wrangler.jsonc` declares as required: `JWT_SECRET`,
`ADMIN_API_TOKEN`, `HOME_AGENT_TOKEN`, `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET`,
`RESEND_API_KEY`, `CATALOG_ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`,
`ACCESS_ADMIN_EMAILS`; optionally `OPS_COLLECTOR_TOKEN`; and per `rollout-ops2.md` §3
`ALERT_TELEGRAM_BOT_TOKEN` on **both** `wrangler.jsonc` and `wrangler.admin.jsonc`.
`CATALOG_ENCRYPTION_KEY` is the one that turns a restore into a non-restore: `managed_exit_catalog`
stores only `ciphertext` + `nonce`, so without that exact key revision 48 is unreadable and every
client loses its exit list even though the row came back. `JWT_SECRET` is the second: restoring it
un-revokes the 370 restored session rows; not restoring it silently logs everyone out.
Also outside Cloudflare entirely: the private half of `TRAFFIC_POLICY_PUBLIC_KEY`, held only in the
operator keychain (`tono-policy-signing`) — needed to re-sign a traffic policy, and in no backup.

**R2 objects — not backed up at all.** `tono-diagnostics-logs` holds the raw log segments; D1 keeps
only the `diagnostics_log_objects` index, so a D1-only restore leaves an index pointing at objects
that may not exist. `tono-releases` holds the installers clients download — and also holds the
backups themselves, so if that bucket is what is lost, the restore path is lost with it. There is no
script for either bucket.

**DNS and routes.** Custom domains `api.afk.ccwu.cc` and `releases.afk.ccwu.cc` on the main Worker,
`admin.afk.ccwu.cc` on the admin Worker, the `*/5 * * * *` cron trigger, and the `ASSETS` binding
with `run_worker_first`. A restored D1 attached to a Worker with no route serves nothing.

**Cloudflare Access.** `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `ACCESS_ADMIN_EMAILS` name an Access
application that has to exist; the `/ops2/` console is unreachable without it.

**A production restore procedure that does not exist yet.** `restore-control-plane-d1-preview.sh`
hard-refuses `tono-control-plane` by design (name check plus an argv scan), and `d1-backups.md` says
to delete and recreate the target database — which for production would mean a new `database_id` and
a redeploy of both Workers. So the only production paths are (a) import into a new D1 and repoint
`database_id` in `wrangler.jsonc` + `wrangler.admin.jsonc`, then redeploy, or (b) wipe-and-import in
place, which this drill just proved needs a dependency-ordered drop script that does not exist. That
script is the concrete gap.

**Retention.** `docs/ops/d1-backups.md` states the 90-day R2 lifecycle rule on prefix `backups/` must
be set in the dashboard and cannot be set from the repo. Not verifiable from here (wrangler has no
object-list command in 4.129), so it remains unconfirmed.

---

## Commands run against production

One: an attempted read-only `SELECT count(*)` cross-check, blocked by the session permission
classifier before it reached Cloudflare. Not retried. Nothing else in this drill named
`tono-control-plane` except the two scripts read as files. No repo file was edited, no git state
changed, no database created or deleted, and no secret value appears in this report.
