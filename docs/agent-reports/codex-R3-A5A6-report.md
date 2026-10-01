Four fixes merged through green CI. All used auto-merge with merge commits and carry `needs-hardware`:

- [#1036](https://github.com/raydocs/tono/pull/1036): retain AI blocking after catalog exit removal.
- [#1038](https://github.com/raydocs/tono/pull/1038): bound optional Service shutdown during Quit.
- [#1045](https://github.com/raydocs/tono/pull/1045): preserve interactive sign-in during startup restore.
- [#1047](https://github.com/raydocs/tono/pull/1047): reset failover when replacing an account.

Paths below are relative to `apps/windows/app/src-tauri/src`; lines refer to audited baselines.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-CATALOG-VANISH-AI-HOLD | A5 | P1 | tono/connection/switch.rs:62 | Automatic exit removal drops AI blocking | Fixed #1036 |
| WIN-IDLE-QUIT-IPC-DELAY | A6 | P1 | feat/window.rs:538 | Optional IPC delays Quit up to 127 seconds | Fixed #1038 |
| WIN-STARTUP-AUTH-SUPERSESSION | A6 | P2 | tono/commands/restore.rs:128 | Delayed startup supersedes newer sign-in | Fixed #1045 |
| WIN-REPLACEMENT-HEAL-STATE | A5 | P2 | tono/commands/account.rs:359 | Replacement account inherits old backup dial | Fixed #1047 |
| WIN-GRANT-FLUSH-QUEUE | A5 | P2 | tono/offline_grant.rs:512 | Timed-out flushes accumulate behind a prolonged vault stall | Real-unfixed: lower priority; native reproduction pending |
| WIN-UPDATE-CONNECTING-CLEANUP | A6 | P2 | tono/commands/update.rs:277 | Update overlap abandons a Connecting barrier | Real-unfixed: conditional overlap; watchdog bounds recovery to seven minutes |
| WIN-UPDATE-TOKEN-FLUSH | A6 | P2 | tono/commands/update.rs:202 | Failed update can lose an undurable rotated token | Real-unfixed: requires vault-write and publication failures plus late reopening |
| WIN-FAILED-PREPARE-AI-HOLD | A6 | P1 | tono/connection/disconnect.rs:267 | Pending-update cleanup discards narrow release intent | Duplicate #1040; alternate branch abandoned |
| R3-A5-CONNECTING-ROUTING | A5 | P2 | tono/catalog_sync.rs:346 | Catalog rotation during Connecting leaves stale routing | Duplicate known #787 limitation |
| R3-A6-PROXY-SINGLETON | A6 | P3 | utils/server.rs:100 | Singleton notification inherits proxy | Duplicate #984 |
| R3-A6-ADOPT-INCOMPLETE | A6 | P2 | tono/commands/update.rs:346 | Failed Adopt latches INCOMPLETE | Duplicate BRICK-W10 |
| R3-A6-MANUAL-LEASE | A6 | P2 | tono/commands/update.rs:364 | Manual lease refuses pending release | Duplicate BRICK-W2/BRICK-W5 |
| R3-A6-SPAWN-FAIL | A6 | P1 | tono/commands/update.rs:208 | Executor spawn failure retains protection | Duplicate #961 |
| R3-A6-PREPARE-STOP | A6 | P1 | tono/commands/update.rs:195 | Prepare failure after Core stop retains protection | Duplicate #793 |
| R3-A6-QUIT-POLLING | A6 | P2 | tono/commands/quit.rs:452 | Cancelled Quit loses catalog polling | Duplicate #784 |
| R3-A5-OLD-CATALOG | A5 | — | tono/catalog_sync.rs:374 | Older response replaces newer catalog | False positive: mutex and revision tracker |
| R3-A5-STALE-LOGOUT | A5 | — | tono/catalog_sync.rs:313 | Late catalog commits after sign-out | False positive: authentication-generation guard |
| R3-A5-GRANT-TTL | A5 | — | tono/offline_grant.rs:241 | Grant expiry cuts internet | False positive: deliberate no-TTL design |
| R3-A5-VERDICT | A5 | — | tono/offline_grant.rs:566 | Old refusal suspends replacement account | False positive: identity-epoch guard |
| R3-A5-ROAMING-TOKEN | A5 | — | tono/commands/account.rs:685 | Rebind restores an old token | False positive: vault-locked current-token read |
| R3-A5-POLICY-ACCOUNT | A5 | — | tono/policy_sync.rs:40 | Policy leaks across accounts | False positive: signed policy is global |
| R3-A5-ACCOUNT-CANCEL | A5 | — | tono/commands/account.rs:575 | Cancelled sign-out abandons teardown | False positive: detached close/release ownership |
| R3-A5-STALE-CACHE | A5 | — | tono/catalog_sync.rs:146 | Replacement login uses previous account cache | False positive: token-bound grant refuses admission |
| R3-A6-QUIT-RESTORE | A6 | — | tono/commands/restore.rs:210 | Late restore rearms after Quit | False positive: connection-generation/runtime guards |
| R3-A6-COMMITTED-HANG | A6 | — | lib.rs:657 | Committed exit hangs indefinitely | False positive: ten-second cleanup budget |
| R3-A6-WATCHDOG-CANCEL | A6 | — | lib.rs:286 | Cancelled Quit disables recovery watchdog | False positive: affected watchdog is diagnostic |
| R3-A6-MISSING-STATE | A6 | — | tono/commands/quit.rs:303 | Missing state prevents release | False positive: independent owner-release path |
| R3-A6-SILENT-WINDOW | A6 | — | resolve/window.rs:159 | Silent boot shows a window | False positive: startup does not create it |
| R3-A6-CORE-CLEANUP | A6 | — | feat/window.rs:558 | Core cleanup is indefinitely unbounded | False positive: finite IPC; deliberate noncancellation |
| R3-A6-LEGACY-PREPARE | A6 | — | tono/commands/quit.rs:141 | Legacy cleanup strands protection | False positive: unregistered, no production caller |
| R3-A6-UPDATE-OFFER | A6 | — | tono/commands/update.rs:107 | Stale offer installs a downgrade | False positive: hash and release-floor checks |
| R3-A6-STALE-COMPENSATION | A6 | — | tono/commands/update.rs:183 | Stale Connect releases update protection | False positive: `release_on_stale=false` |

**32 hypotheses:** four fixed, three unfixed, eight duplicates, **17 false positives**.

All assigned files were read end to end. Unfinished work: the three conditional P2 fixes and real-device validation. Hosted native Windows CI passed for all four PRs; the unfixed findings have source traces but lack native reproductions.

Full evidence and records: [report.md](/workspace/w1-codex/out/R3-A5A6/report.md), [findings.tsv](/workspace/w1-codex/out/R3-A5A6/findings.tsv), [prs.tsv](/workspace/w1-codex/out/R3-A5A6/prs.tsv).