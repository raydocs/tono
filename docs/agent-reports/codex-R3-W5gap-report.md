Operator follow-up: #982’s revised body update failed twice because `gh pr edit` queried a deprecated GraphQL field. Code is pushed on `hunt/sol-r3dns-restore-write`; title: **fix(windows): complete DNS restore when snapshot refresh fails**. The revised body is saved in [pr-restore-write.md](/workspace/w1-codex/out/R3-W5gap/pr-restore-write.md).

Four verified fixes shipped; three have merged. AI-blocking and strict-mode guards remain intact.

| PR | Status | Labels | Merge-commit auto-merge |
|---|---|---|---|
| [#982](https://github.com/raydocs/tono/pull/982) | Windows/services checks green; macOS jobs queued | needs-hardware | Enabled |
| [#985](https://github.com/raydocs/tono/pull/985) | Merged, CI green | needs-hardware | Enabled |
| [#987](https://github.com/raydocs/tono/pull/987) | Merged, CI green | needs-hardware | Enabled |
| [#989](https://github.com/raydocs/tono/pull/989) | Merged, CI green | needs-hardware | Enabled |

DNS filenames below refer to `apps/windows/service/src/core/dns`. Lines are audit-baseline locations.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DNS-RESTORE-SNAPSHOT-WRITE | DNS restore | P1 | mod.rs:2731 | Snapshot bookkeeping write failure skips policy cleanup and blocks disarm | Fixed in #982 |
| WIN-DNS-DOH-CAPTURE-DELETE | DNS engine | P1 | engine.rs:1634 | Restored capture deletion failure aborts policy cleanup | Fixed in #985 |
| WIN-DNS-DOH-NEW-TEMPLATE | DNS engine | P2 | engine.rs:481 | New adapter DoH settings suppressed without saving originals | Fixed in #987 |
| WIN-DNS-SPACE-LIST | DNS parsing | P2 | mod.rs:550 | Space-separated originals become one invalid resolver address | Fixed in #989 |
| BRICK-W7 | Restore proof | P1 | engine.rs:1323 | “Live” restore verification reads registry values | Duplicate of known BRICK-W7 |
| WIN-DNS-SNAPSHOT-DELETE-BLOCKS | DNS restore | P1 | mod.rs:2812 | Snapshot deletion failure blocks disarm | Duplicate of #769/#827 |
| WIN-STOPCLASH-UNRECORDED | DNS callers | P1 | core/server/handlers.rs:842 | Failed stop bookkeeping skips DNS restore | Duplicate of #930 |
| BRICK-W11-DNS | Snapshot writes | P2 | mod.rs:1403 | Late replacement may republish a retired snapshot | Duplicate of known BRICK-W11 mechanism; DNS timing unproven |
| W5-PROFILE-ORIGINALS | DNS originals | — | mod.rs:879 | Wi-Fi profile change may restore previous profile DNS | Unverified; Windows registry transition trace needed |
| W5-NETSH-LATE | Processes | — | engine.rs:827 | Timed-out descendant may commit DNS late | Unverified; native timing reproduction needed |
| W5-SCOPED-V6 | DNS parsing | — | engine.rs:1067 | Percent-zone IPv6 address rejected by script guard | Unverified; ordinary registry producer not established |
| W5-NATIVE-ABI | Native apply | — | native_apply.rs:25 | Native ABI might corrupt input | False positive: documented GUID and settings ABI match |
| W5-NATIVE-ORIGINALS | Native apply | — | native_apply.rs:116 | Empty protected IPv6 might destroy originals | False positive: restore-shaped entries rejected; originals restored separately |
| W5-NATIVE-PARTIAL | Native apply | — | native_apply.rs:137 | IPv4 success might mask IPv6 failure | False positive: either failure triggers compatibility fallback |
| W5-NATIVE-READBACK | Native apply | — | native_apply.rs:261 | Missing readback might count as success | False positive: unavailable readback remains unverified |
| W5-NATIVE-CASE | Native apply | — | native_apply.rs:217 | GUID comparison might be case-sensitive | False positive: comparison ignores case |
| W5-NATIVE-IDENTITY | Native apply | — | native_apply.rs:218 | Replacement adapter might satisfy old obligation | False positive: LUID and both indices checked; absent obligation retained |
| W5-NATIVE-TIMEOUT | Native apply | — | mod.rs:1732 | Timed-out setter might overlap restore | False positive: engine claim retained until worker returns |
| W5-NATIVE-SCOPE | Native apply | — | native_apply.rs:195 | Scope omission might prove an empty list | False positive: address remains nonempty |
| W5-NATIVE-SHUTDOWN | Service shutdown | — | src/service.rs:503 | Wedged native call might hang SCM shutdown | False positive: production uses `shutdown_background` |
| W5-SNAPSHOT-CASE | Snapshots | — | mod.rs:1042 | GUID case might lose originals | False positive: snapshot and proof comparisons ignore case |
| W5-RESTART-REDIRECT | Recovery | — | mod.rs:3167 | Retained snapshot might rearm released DNS | False positive: startup also requires WFP wanted intent |
| W5-RESTORE-RECONCILE | Watchdog | — | mod.rs:2679 | Watchdog might re-protect after restore | False positive: restore clears wanted state; reconcile cannot initialize protection |
| W5-LOCAL-RESOLVER | Restore proof | — | mod.rs:1126 | Legitimate local resolver might block disconnect | False positive: saved local-only resolvers handled separately |
| W5-EMPTY-DNS | DNS originals | — | mod.rs:550 | Empty saved DNS might incorrectly become DHCP | False positive: deliberate documented restore contract |
| W5-INACTIVE-ORIGINALS | DNS originals | — | mod.rs:1058 | Inactive adapter originals might escape restore | False positive: registry originals restored for all saved adapters |
| W5-ENGINE-INACTIVE | DNS engine | — | engine.rs:1297 | Engine might omit inactive adapter keys | False positive: only live apply skips absent adapters |
| W5-ENGINE-CASE | DNS engine | — | engine.rs:676 | Compatibility GUID casing might lose outcomes | False positive: normalized lookup preserves snapshot identity |
| W5-SNAPSHOTLESS-NRPT | Resolver policy | — | mod.rs:2689 | Missing snapshot might skip NRPT cleanup | False positive: snapshotless restore still restores policy |
| W5-CIM84-V6 | DNS engine | — | engine.rs:978 | CIM84 might skip IPv6 restoration | False positive: #868 removed early return; regression exists |
| W5-CHILD-JOB | Processes | — | core/process.rs:298 | Script might start before Job binding | False positive: suspended launch binding already fixed |
| W5-PIPE-HANG | Processes | — | engine.rs:909 | Pipe drain might retain writer forever | False positive: concurrent drains, deadline and retained worker claim |

**21 false positives; 32 hypotheses examined:** four verified fixes, four duplicates and three unverified candidates.

The two portable regressions failed before their fixes and passed afterward; focused DNS suites passed **59 tests each**. All four new regressions also passed in hosted Windows CI. Native Windows execution was unavailable locally.

All assigned source files were read. Remaining work requires Windows hardware: the three unverified candidates and installed DNS/WFP recovery qualification. #982’s final CI is still pending queued macOS runners.

The full report, logs and CI receipts are saved in [audit-report.md](/workspace/w1-codex/out/R3-W5gap/audit-report.md).