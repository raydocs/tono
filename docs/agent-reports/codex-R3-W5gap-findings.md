# R3-W5gap: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:48 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 982 | hunt/sol-r3dns-restore-write | needs-hardware | yes | fix(windows): complete DNS restore when snapshot refresh fails |
| 985 | hunt/sol-r3dns-doh-retirement | needs-hardware | yes | fix(windows): allow DNS release with locked restored DoH captures |
| 987 | hunt/sol-r3dns-doh-new-template | needs-hardware | yes | fix(windows): preserve DoH originals for new session adapters |
| 989 | hunt/sol-r3dns-space-lists | needs-hardware | yes | fix(windows): restore space-delimited original DNS lists |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DNS-RESTORE-SNAPSHOT-WRITE | W5 DNS facade | P1 | apps/windows/service/src/core/dns/mod.rs:2731 | Snapshot refresh write failure skips resolver-policy restore and blocks disarm | real-fixed #982 |
| W5-NATIVE-ABI | W5 native apply | — | apps/windows/service/src/core/dns/native_apply.rs:25 | Native settings/GUID ABI corrupts input | false-positive documented by-value GUID and V1 structure match |
| W5-NATIVE-ORIGINALS | W5 native apply | — | apps/windows/service/src/core/dns/native_apply.rs:116 | Empty protected IPv6 destroys DHCP/static originals | false-positive restore-shaped entries rejected; saved family values restored separately |
| W5-NATIVE-PARTIAL | W5 native apply | — | apps/windows/service/src/core/dns/native_apply.rs:137 | IPv4 success masks IPv6 failure | false-positive either setter failure triggers compatibility fallback |
| W5-NATIVE-READBACK | W5 native apply | — | apps/windows/service/src/core/dns/native_apply.rs:261 | Missing readback accepted as success | false-positive unavailable effective readback marks entries unverified |
| W5-NATIVE-CASE | W5 native apply | — | apps/windows/service/src/core/dns/native_apply.rs:217 | Native adapter GUID comparison is case-sensitive | false-positive comparison is case-insensitive |
| W5-NATIVE-IDENTITY | W5 native apply | — | apps/windows/service/src/core/dns/native_apply.rs:218 | Replaced or disappeared adapter is accepted | false-positive native requires LUID and both indices; absent obligation retained |
| W5-NATIVE-TIMEOUT | W5 native apply | — | apps/windows/service/src/core/dns/mod.rs:1732 | Timed-out setter overlaps compatibility restore | false-positive engine claim retained until worker returns |
| W5-NATIVE-SCOPE | W5 native apply | — | apps/windows/service/src/core/dns/native_apply.rs:195 | IPv6 scope omission proves an empty list | false-positive scoped addresses remain nonempty IPv6 strings |
| W5-NATIVE-SHUTDOWN | W5 native apply | — | apps/windows/service/src/service.rs:503 | Wedged native call hangs SCM runtime shutdown | false-positive production uses shutdown_background |
| BRICK-W7 | W5 restore proof | P1 | apps/windows/service/src/core/dns/engine.rs:1323 | Live restore verifier reads the registry | duplicate of known BRICK-W7 |
| WIN-DNS-SNAPSHOT-DELETE-BLOCKS | W5 DNS facade | P1 | apps/windows/service/src/core/dns/mod.rs:2812 | Snapshot delete failure blocks disarm | duplicate of #769 and #827 |
| WIN-STOPCLASH-UNRECORDED | W5 DNS callers | P1 | apps/windows/service/src/core/server/handlers.rs:842 | Failed stop bookkeeping skips DNS restore | duplicate of #930 |
| WIN-DNS-DOH-CAPTURE-DELETE | W5 DNS engine | P1 | apps/windows/service/src/core/dns/engine.rs:1634 | Capture deletion failure aborts restored resolver policy and disarm | real-fixed #985 |
| WIN-DNS-DOH-NEW-TEMPLATE | W5 DNS engine | P2 | apps/windows/service/src/core/dns/engine.rs:481 | New adapter DoH flags suppressed without saved originals | real-fixed #987 |
| WIN-DNS-SPACE-LIST | W5 DNS parsing | P2 | apps/windows/service/src/core/dns/mod.rs:550 | Documented space-delimited original DNS lists rejected by compatibility apply | real-fixed #989 |
| W5-SNAPSHOT-CASE | W5 snapshots | — | apps/windows/service/src/core/dns/mod.rs:1042 | GUID case destroys originals or restore identity | false-positive case-insensitive snapshot/active/proof comparisons; #754 |
| W5-RESTART-REDIRECT | W5 recovery | — | apps/windows/service/src/core/dns/mod.rs:3167 | A retained snapshot reactivates DNS after release | false-positive startup also requires WFP wanted intent |
| W5-RESTORE-RECONCILE | W5 watchdog | — | apps/windows/service/src/core/dns/mod.rs:2679 | Watchdog re-protects DNS after failed restore | false-positive restore clears PROTECTION_WANTED and reconcile cannot initialize from nothing |
| W5-LOCAL-RESOLVER | W5 restore proof | — | apps/windows/service/src/core/dns/mod.rs:1126 | Legitimate saved local resolver blocks every disconnect | false-positive saved local-only resolvers excluded from live Tono proof; exact registry match required |
| W5-EMPTY-DNS | W5 originals | — | apps/windows/service/src/core/dns/mod.rs:550 | Empty saved DNS incorrectly becomes DHCP | false-positive documented Windows registry ambiguity and deliberate restore contract |
| W5-INACTIVE-ORIGINALS | W5 originals | — | apps/windows/service/src/core/dns/mod.rs:1058 | Inactive adapter originals escape restoration | false-positive registry restores all saved entries; absent effective resolver deliberately skipped |
| W5-ENGINE-INACTIVE | W5 engine | — | apps/windows/service/src/core/dns/engine.rs:1297 | Engine omits inactive original adapter keys | false-positive only live apply skips absent adapters; registry values still written |
| W5-ENGINE-CASE | W5 engine | — | apps/windows/service/src/core/dns/engine.rs:676 | Compatibility adapter casing loses outcomes | false-positive active map uppercases GUIDs and returned results retain snapshot spelling |
| W5-SNAPSHOTLESS-NRPT | W5 resolver policy | — | apps/windows/service/src/core/dns/mod.rs:2689 | Missing snapshot skips NRPT cleanup | false-positive every snapshotless restore runs resolver-policy restore |
| W5-CIM84-V6 | W5 engine | — | apps/windows/service/src/core/dns/engine.rs:978 | CIM84 returns before IPv6 restoration | false-positive #868 removed early return; existing regression pins it |
| W5-CHILD-JOB | W5 engine processes | — | apps/windows/service/src/core/process.rs:298 | DNS script starts before kill-on-exit Job binding | false-positive suspended process binding already fixed in R680/#684 |
| W5-PIPE-HANG | W5 engine processes | — | apps/windows/service/src/core/dns/engine.rs:909 | Pipes retain async DNS writer forever | false-positive concurrent drains plus child deadline and bounded worker claim |
| W5-PROFILE-ORIGINALS | W5 originals | — | apps/windows/service/src/core/dns/mod.rs:879 | SSID change may restore old ProfileNameServer | unverified Windows profile-transition evidence required |
| W5-NETSH-LATE | W5 engine processes | — | apps/windows/service/src/core/dns/engine.rs:827 | Timed-out netsh descendant may commit DNS6 late | unverified native subprocess timing required; related R680 limitation |
| W5-SCOPED-V6 | W5 engine parsing | — | apps/windows/service/src/core/dns/engine.rs:1067 | Scoped IPv6 resolver may be rejected by script guard | unverified ordinary registry producer for percent scope suffix not established |
| BRICK-W11-DNS | W5 snapshot writes | P2 | apps/windows/service/src/core/dns/mod.rs:1403 | Abandoned shared-temp replacement can publish a stale DNS snapshot after release | duplicate of known BRICK-W11 mechanism; DNS extension and native timing untested |
