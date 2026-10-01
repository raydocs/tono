# R4-RestoreDNS: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:23 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1076 | hunt/sol-r4dns-retired-snapshot | needs-hardware | yes | fix(windows): retire restored DNS snapshots before the next session |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| REG-1033 | macOS DNS | — | ProtectedDNSManager.swift:321 | Valid-snapshot Apply retry survives combined changes | ok |
| REG-1030 | macOS DNS | — | ProtectedDNSManager.swift:984 | Nonblocking preferences lock preserves retry state | ok |
| REG-765 | macOS DNS | — | ProtectedDNSManager.swift:147 | Snapshot save/load/write DNS count caps agree | ok |
| REG-756 | macOS launch DNS | — | RuntimeCleanup.swift:421 | Helper repair always requests snapshotless restore | ok |
| MAC-SELECTIVE-RESOLVER-OWNERSHIP | macOS DNS | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:171 | Selective layer deletes and overwrites foreign resolver files | real-unfixed issue #1062; native ownership/recovery contract needed |
| MAC-DNS-SNAPSHOTLESS-APPLY-RETRY | macOS DNS | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:356 | Snapshotless retry skips activation after successful Commit and failed Apply | real-unfixed issue #1063; two failures and native qualification required |
| WIN-DNS-RETIRED-SNAPSHOT-REPLAY | Windows DNS | P2 | apps/windows/service/src/core/dns/mod.rs:2852 | Restored but retained adapter snapshot replays old session originals after DNS changes | real-fixed #1076 (awaiting CI/merge) |
| DNS-CALLBACK-LIFETIME | Windows app DNS | P2 | apps/windows/app/src-tauri/src/tono/windows_dns.rs:39 | Published outcome lets waiter retire completion during callback | false-positive: callback-owned Arc lasts through notification |
| WIN-IDLE-TOMBSTONE-DNS-SKIP | Windows WFP/DNS | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2764 | Idle tombstone write error appears to skip DNS restore | false-positive: ordinary release handler restores DNS first; SCM scenario needs previous restore failure |
| WIN-FAILED-START-STRICT-ROLLBACK | Windows WFP | P2 | apps/windows/service/src/core/server/handlers.rs:765 | StartClash failure rollback appears to release strict protection | false-positive: preceding successful bootstrap arm is always non-strict |
