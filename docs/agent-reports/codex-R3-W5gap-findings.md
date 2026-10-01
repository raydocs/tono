# R3-W5gap: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 20:05 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DNS-RESTORE-SNAPSHOT-WRITE | W5 DNS facade | P1 | apps/windows/service/src/core/dns/mod.rs:2731 | Snapshot refresh write failure skips resolver-policy restore and blocks disarm | real-unfixed regression running |
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
