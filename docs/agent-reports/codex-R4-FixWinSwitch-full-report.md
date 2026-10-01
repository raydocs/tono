Four verified findings fixed in five PRs; fourteen rejected hypotheses and two duplicates. All five PRs merged through CI.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4-WIN-UNARMED-SELECTION | Windows/unarmed recovery | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:124 | Late proof overwrites newer idle selection (#1094) | duplicate of #1098 |
| R4-WIN-STALE-HEALTH-RELEASE | Windows/health switch | P2 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Old A failure releases healthy B (#1093/#1095) | real-fixed #1133 + #1150 (publication-before-proof and A→B→A residual windows) |
| FP-HEALTH-GENERATION | Windows/health switch | — | apps/windows/app/src-tauri/src/tono/commands/catalog.rs:294 | Generation-only guard already protects hot switch | false-positive hot switch deliberately preserves generation |
| FP-HEALTH-TERMINAL | Windows/health switch | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1162 | Discarded same-generation proof may terminate monitor | false-positive monitor must continue; regression verifies this |
| WIN-UNARMED-TIMEOUT-OWNER | Windows/unarmed recovery | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:159 | Own timeout retirement ends automatic recovery (#1101) | real-fixed #1138 |
| FP-TIMEOUT-REPLACEMENT | Windows/unarmed recovery | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:33 | Failure spawns a replacement recovery owner | false-positive task-local suppression prevents replacement |
| R4FO-WIN-EXPLICIT-RELEASE-JOIN-AI-HOLD | Windows/disconnect | P2 | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:143 | User Disconnect loses remove-AI intent when joining auto release (#1109) | real-fixed #1142 |
| FP-RELEASE-IDLE-PROOF | Windows/disconnect | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:377 | Idle broad status proves AI hold is absent | false-positive separate AI hold; #1112 already fixes idle dispatch |
| FP-RELEASE-FLAG-SEAL | Windows/disconnect | — | apps/windows/app/src-tauri/src/tono/state.rs:788 | Atomic flag alone can retain late removal request | false-positive check+seal must share slot lock; implemented in #1142 |
| R4-WIN-LATE-RELEASE-RECOVERY | Windows/automatic release | P2 | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:62 | Successful release after 55s UI wait loses automatic recovery | real-fixed #1156 |
| R4-FWS-FP-ROLLBACK | Windows/switch | — | apps/windows/app/src-tauri/src/tono/connection/switch.rs:285 | Late rollback may mutate a successor | false-positive retained lifecycle writer excludes startup; captured owner-session proof |
| R4-FWS-FP-DIRECT-DEADLOCK | Windows/switch | — | apps/windows/app/src-tauri/src/tono/connection/stages.rs:435 | Catalog rebuild awaits DIRECT while retaining policy writer | false-positive optional DIRECT activation is spawned, never awaited by startup |
| R4-FWS-FP-PIN-ADOPTION | Windows/monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:452 | Old controller DNS response adopts cross-account state | false-positive public API-host pins; checked generation, no account/runtime state adoption |
| R4-FWS-FP-COLD-HOLD | Windows/switch | — | apps/windows/app/src-tauri/src/tono/connection/switch.rs:384 | Ordinary failed cold switch retains global WFP indefinitely | false-positive non-strict cleanup calls shared AI-held release; strict/persistence paths excluded |
| WIN-UNRECORDED-STOP-NONSTRICT-HOLD | Windows/policy recovery | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1478 | Confirmed Core stop plus persistent-write failure retains global WFP | duplicate #1139; documented restart disposition needs product decision, native repro pending |
| R4FWS-FP-SAMPLER | Windows/unarmed recovery | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:268 | Replacement owners accumulate hung native sampler threads | false-positive process-wide semaphore permit stays inside blocking worker |
| R4FWS-FP-TCP-BUSY | Windows/unarmed recovery | — | apps/windows/crates/tono-core/src/unarmed_probe.rs:87 | Unreachable exits trigger immediate TCP retry loop | false-positive exhausted targets use capped backoff and return Wait |
| R4FWS-FP-STALE-CONNECT | Windows/unarmed recovery | — | apps/windows/app/src-tauri/src/tono/connection.rs:385 | Recovery admits stale connect after TCP preflight | false-positive captured selection and atomic begin_attempt generation check |
| R4FWS-FP-ARMED-TCP | Windows/unarmed recovery | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:355 | Core-only WFP permits deny protected App TCP recovery proof | false-positive armed recovery bypasses App TCP proof and uses protected transaction |
| R4FWS-FP-HY2-TCP | Windows/unarmed recovery | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:195 | HY2 recovery incorrectly relies on TCP reachability | false-positive HY2 excluded from TCP probe; explicit Connect bypasses preflight |

PRs: #1133, #1138, #1142, #1150 and #1156 all merged with native Windows CI passing. All needs-hardware; merge-commit auto-merge enabled.

False-positive count: 14. Total hypotheses examined: 20. Same health finding/ABA continuation counted once; #1093/#1095 counted once.

Assigned monitor/switch/unarmed_probe/disconnect source audit complete. Native WFP/DNS/real-device failure testing unavailable. Existing #1139 needs a product decision; no unsafe change made.

Hunter: GPT-6.1 Sol (Codex CLI)

Final merge evidence: #1150 6c9bc2f3, #1156 28d9c26e; #1150 CI run36831283765 passed all required jobs. Earlier fe087b0c failed test compilation (Duration import), corrected in49b712b2; no skip/gate change. All refs present in origin/main.

Corrected #1150 native Windows log confirms all three health regressions execute and pass, and 628 Tauri tests pass (job110268423784). Same run also executes the timeout-owner, release-join and automatic late-release regressions. Native CI covers compilation/runtime of those injected boundaries, not real-device WFP/DNS fault acceptance.
