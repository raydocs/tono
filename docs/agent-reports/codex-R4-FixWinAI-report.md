Five PRs merged through required CI: [#1147](https://github.com/raydocs/tono/pull/1147), [#1155](https://github.com/raydocs/tono/pull/1155), [#1163](https://github.com/raydocs/tono/pull/1163), [#1168](https://github.com/raydocs/tono/pull/1168), [#1172](https://github.com/raydocs/tono/pull/1172). All have `needs-hardware` and used merge-commit auto-merge.

Locations below refer to audited baselines. All areas are Windows.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4UPD-WIN-CONSUME-FAILURE-RELEASE | Update | P1 | update_transaction.rs:468 | Failed consume acknowledgement bypasses cleanup | Fixed in #1172 |
| R4FO-WIN-RELEASE-AI-DISPOSITION-CRASH | Service | P2 | windows_kill_switch.rs:2875 | Automatic release forgets durable AI hold | Fixed in #1147 |
| R4UPD-WIN-ROLLBACK-FINALIZATION | Update | P2 | update_executor.rs:386 | Recovery skips interrupted rollback finalization | Fixed in #1155 |
| R4UPD-WIN-CAPTURE-FAILURE-RELEASE | Update | P2 | update_executor.rs:417 | Token capture refusal bypasses cleanup | Fixed in #1163 |
| R3REGW-RECOVERY-PUBLICATION-FLOOR | Update | P2 | update_executor.rs:394 | Recovery omits App process-age floor | Fixed in #1168 |
| WIN-UPDATE-TOKEN-FLUSH | App | P2 | commands/update.rs:201 | Native termination loses pending credential writes | Real-unfixed #1055: needs auth pause/drain through handoff |
| R3KS1-PENDING-EXPIRY | WFP | P2 | windows_kill_switch.rs:3693 | Pending DIRECT expiry retains full block | Real-unfixed #1056: product disposition required |
| R3REGW-ROLLBACK-DOUBLE-HOLD | AI hold | P2 | selective_layer.rs:91 | Repeated cleanup interrupts AI hold | Duplicate of merged #1087 |
| WIN-SELECTIVE-NATIVE-ORPHAN | AI hold | P2 | selective_layer.rs:327 | Native command ownership is process-local | Duplicate known limitation #988 |
| R4FO-WIN-SELECTIVE-SYSTEM-DIR | AI hold | P2 | selective_layer.rs:327 | Fixed C-drive executable path | Duplicate of merged #1089 |
| R4FWA-GUARD-STARTUP-AUTO-REPLAY | Service | — | windows_kill_switch.rs:3371 | Proposed startup replay guard | Duplicate #1147 proof: guard was absent |
| R4FWA-GUARD-IDLE-REWRITE-SAFE | Service | — | windows_kill_switch.rs:2830 | Proposed idle preservation guard | Duplicate #1147 proof: disposition was discarded |
| WIN-LIVE-BOOTSTRAP-APP-DEATH | WFP | P2 | server/mod.rs:442 | Secondary bookkeeping failure postpones release | Duplicate documented #1021 cleanup limitation |
| W1-UNVERIFIED-OWNER-RETIRE | WFP | P2 | windows_kill_switch.rs:3652 | Failed startup proof retains Blocked | Duplicate documented #777 limitation |
| R4FWA-FP-SINGLETON-FLOOR | Update | — | update_executor.rs:394 | Ordinary parallel Apps exploit missing floor | False positive: singleton excludes this trigger |
| R4FWA-FP-LEGACY-BINDING-STALE-TOKEN | Credentials | — | credentials.rs:315 | Migration overwrites rotated token | False positive: lock and current-binding guard |
| R4FWA-FP-WORKER-CANCEL | AI hold | — | selective_layer.rs:42 | Cancellation strands worker ownership | False positive: no await before spawn |
| R4FWA-FP-WORKER-COMPLETION | AI hold | — | selective_layer.rs:97 | Older request wins over newer disposition | False positive: latest-revision completion |
| R4FWA-FP-COMMAND-INJECTION | AI hold | — | selective_fail_open.rs:193 | Validator admits broad firewall commands | False positive: fixed private templates only |
| R4FWA-FP-NRPT-COLLATERAL | DNS | — | selective_fail_open.rs:32 | Secondary DNS blocks unrelated traffic | False positive: narrow suffixes and distinct GUIDs |
| R4FWA-FP-EXPIRED-CONSUME-RELEASE | Update | — | update_transaction.rs:467 | Every consume refusal should release | False positive: documented expiry policy |
| R4FWA-FP-DIRECT-RETIREMENT-CANCEL | WFP | — | windows_kill_switch.rs:1652 | Lock/MarkVerified cancels retirement | False positive: pending-retirement guard |
| R4FWA-FP-CRASH-TOMBSTONE-OVERWRITE | Service | — | windows_kill_switch.rs:3024 | Retry overwrites new arm or Restore | False positive: serialized supersession |
| R4FWA-FP-WFP-TIMEOUT-OVERLAP | WFP | — | windows_kill_switch.rs:1151 | Timed-out native writers overlap | False positive: native claim survives timeout |
| R4FWA-FP-DESIRED-WFP-LOCK-INVERSION | Service | — | desired.rs:191 | Restore inverts storage/WFP locks | False positive: storage locks release first |

**25 hypotheses examined; 11 false positives.** Every fix had a failing-before/passing-after regression. Final integrated main `8e276a78` passed **27 update-store tests**.

Unfinished: the token-flush and pending-expiry rows above; #1055’s installer/NSIS rows and #1056’s grant-queue, core-job and DHCP rows outside this slot’s files. #1055 remains open for its remaining rows. Real-device network validation remains outstanding.

Evidence and incremental logs: [report](/workspace/w1-codex/out/R4-FixWinAI/report.md), [findings](/workspace/w1-codex/out/R4-FixWinAI/findings.tsv), [PR log](/workspace/w1-codex/out/R4-FixWinAI/prs.tsv).