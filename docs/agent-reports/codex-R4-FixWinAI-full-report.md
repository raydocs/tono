# R4-FixWinAI hunt report

Hunter: GPT-6.1 Sol (Codex CLI)

| ID | area | severity | file:line | one-line description | verdict |
|---|---|---|---|---|---|
| R4FO-WIN-RELEASE-AI-DISPOSITION-CRASH | Windows Service | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2875 | Automatic release loses AI hold intent across Service death | real-fixed #1147 |
| R4UPD-WIN-ROLLBACK-FINALIZATION | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:386 | RolledBack recovery skips interrupted selective finalization | real-fixed #1155 |
| R4UPD-WIN-CAPTURE-FAILURE-RELEASE | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:417 | Token capture refusal exits before failure cleanup | real-fixed #1163 |
| WIN-UPDATE-TOKEN-FLUSH | Windows App update | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:201 | Native update terminates App without retrying queued session credential write | real-unfixed #1055: requires complete auth-mutation pause/drain held through executor handoff; bare flush races refresh |
| R3REGW-RECOVERY-PUBLICATION-FLOOR | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:394 | Complete-publication early recovery omits process-age floor | real-fixed #1168 (only this #1055 row) |
| R3REGW-ROLLBACK-DOUBLE-HOLD | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:91 | Repeated update cleanup formerly interrupted AI hold | duplicate of merged #1087 |
| R3KS1-PENDING-EXPIRY | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3693 | Pending DIRECT expiry retains healthy full Blocked after App death | real-unfixed #1056; documented strict pending design requires product disposition |
| WIN-SELECTIVE-NATIVE-ORPHAN | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:327 | Native command ownership across Service death is process local | duplicate known limitation #988 |
| R4FO-WIN-SELECTIVE-SYSTEM-DIR | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:327 | Fixed C-drive netsh path fails on non-C Windows | duplicate merged #1089 |
| R4FWA-GUARD-STARTUP-AUTO-REPLAY | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:3371 | Assumed unwanted startup already reapplies absent AI hold | duplicate #1147 proof: rejected proposed guard; startup preserved existing AI layer but did not apply missing one |
| R4FWA-GUARD-IDLE-REWRITE-SAFE | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:2830 | Assumed idle rewrite and replacement preserve automatic disposition | duplicate #1147 proof: rejected proposed guard; idle/replacement discarded automatic disposition |
| R4FWA-FP-SINGLETON-FLOOR | Windows update | - | apps/windows/service/src/bin/install_service/update_executor.rs:394 | Assumed ordinary parallel initialized Apps can exploit missing floor | false-positive severity premise: singleton forbids this; pre-singleton mapped peer window only |
| R4FWA-FP-LEGACY-BINDING-STALE-TOKEN | Windows credentials | — | apps/windows/app/src-tauri/src/credentials.rs:315 | Legacy binding migration could overwrite a rotated token | false-positive: vault lock and current-binding read guard stale migration |
| R4FWA-FP-WORKER-CANCEL | Windows selective layer | — | apps/windows/service/src/core/selective_layer.rs:42 | Cancellation could strand the selective worker owner | false-positive: no await between ownership and worker spawn |
| R4FWA-FP-WORKER-COMPLETION | Windows selective layer | — | apps/windows/service/src/core/selective_layer.rs:97 | An old coalesced request could win over a newer disposition | false-positive: completion settles only the latest revision under admission lock |
| R4FWA-FP-COMMAND-INJECTION | Windows selective layer | — | apps/windows/service/src/core/selective_fail_open.rs:193 | Permissive add validator could admit a broad firewall command | false-positive: private runner receives only fixed generated templates |
| R4FWA-FP-NRPT-COLLATERAL | Windows selective DNS | — | apps/windows/service/src/core/selective_fail_open.rs:32 | Secondary DNS could block unrelated general Internet | false-positive: fixed suffix set and unique GUIDs exclude catch-all |
| R4UPD-WIN-CONSUME-FAILURE-RELEASE | Windows update | P1 | apps/windows/service/src/update_transaction.rs:468 | Successful token capture followed by failed consume acknowledgement skips network cleanup | real-fixed #1172 (Fixes #1171) |
| R4FWA-FP-EXPIRED-CONSUME-RELEASE | Windows update | — | apps/windows/service/src/update_transaction.rs:467 | All post-capture consume failures should automatically release | false-positive: expiry/clock refusal intentionally retains protection per UPDATE_PROTOCOL_V1:96; only persistence error is changed |
| R4FWA-FP-DIRECT-RETIREMENT-CANCEL | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:1652 | Lock/MarkVerified could cancel committed DIRECT retirement | false-positive: pending retirement flag rejects both operations; lifecycle cleanup remains epoch-fenced |
| R4FWA-FP-CRASH-TOMBSTONE-OVERWRITE | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:3024 | Pending crash record could overwrite a new arm or Restore | false-positive: WFP writer fencing and pending-state clearing serialize supersession |
| R4FWA-FP-WFP-TIMEOUT-OVERLAP | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:1151 | Timed-out native WFP work could overlap later writers | false-positive: EngineCallClaim survives caller timeout; subsequent calls refuse until it returns |
| R4FWA-FP-DESIRED-WFP-LOCK-INVERSION | Windows Service | — | apps/windows/service/src/core/desired.rs:191 | Desired-state lock could invert with WFP during restore | false-positive: storage locks are released before manager/WFP restoration calls |
| WIN-LIVE-BOOTSTRAP-APP-DEATH | Windows WFP | P2 | apps/windows/service/src/core/server/mod.rs:442 | Secondary desired-state failure postpones expired-owner release | duplicate documented cleanup limitation #1021 and WIN-DIRECT-EXPIRY-LIVE-CORE; needs original death plus bookkeeping failure |
| W1-UNVERIFIED-OWNER-RETIRE | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3652 | Unverified startup owner/DNS refusal retains healthy Blocked | duplicate known W1-UNVERIFIED-OWNER-RETIRE/#777 limitation; interrupted startup plus proof failure, deliberate recovery order |

False positives: 11; total hypotheses examined: 25.

| PR | branch | label | merge-commit auto-merge | status |
|---|---|---|---|---|
| [#1147](https://github.com/raydocs/tono/pull/1147) | hunt/sol-r4fwa-ai-hold | needs-hardware | yes | merged; native Windows CI green |
| [#1155](https://github.com/raydocs/tono/pull/1155) | hunt/sol-r4fwa-rollback-finalize | needs-hardware | yes | merged; native Windows CI green |
| [#1163](https://github.com/raydocs/tono/pull/1163) | hunt/sol-r4fwa-capture-refusal | needs-hardware | yes | merged; native Windows CI green |
| [#1168](https://github.com/raydocs/tono/pull/1168) | hunt/sol-r4fwa-recovery-clock | needs-hardware | yes | merged; native Windows CI green |
| [#1172](https://github.com/raydocs/tono/pull/1172) | hunt/sol-r4fwa-consume-refusal | needs-hardware | yes | merged; native Windows CI green |

Verified regressions failed before and passed after each fix. Linux checks: #1147 WFP facade 120 passed; #1155 Store 20 passed; #1163 Store 19 passed; #1168 Store 15 passed; #1172 integrated Store 26 passed. These are separate baseline suites, not additive coverage counts. Final integrated origin/main 8e276a7839852d2a32eca07d66c2025fa1d032ac: 27 update-store tests passed. See final-main-store-tests.log. Native Windows integration is covered by hosted CI; real filesystem/SCM/WFP/NRPT packet recovery is not proven without hardware. No deployment, publishing, signing or candidate package.

Unfinished: WIN-UPDATE-TOKEN-FLUSH (#1055) needs a complete auth-mutation pause/drain held through native handoff; a bare flush races later refresh. R3KS1-PENDING-EXPIRY (#1056) conflicts with documented pending DIRECT protection and needs product disposition. #1055 W9-DEFERRED-PARTIAL-STAGE / W9-RESOURCE-CANCEL-REPAIR and #1056 WIN-GRANT-FLUSH-QUEUE / WIN-CORE-JOB-SPAWN-WINDOW / WIN-DHCPV6-RELAY-SOURCE lie outside this slot’s listed files; not fully audited or fixed.

#1055 was reopened after #1168 automatically closed the aggregate, so remaining rows stay tracked. Only its publication-floor row was fixed here. No additional issue comments were posted beyond the exact Taking this (Codex Sol) claims.

No local-only unpushed fixes remain. Full incremental artifacts: findings.tsv, prs.tsv and regression logs in this output directory.
