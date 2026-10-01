No runtime patch shipped by this slot: the two recovery fixes need a supported AI-preserving transition; replacement-account fix was already opened as #1047 by another hunter during our implementation.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows health recovery | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Automatic release never cancels stalled DIRECT reader | real-unfixed; #1046 decision record. Cancellation-only opens AI sooner through current WFP-before-best-effort-hold release |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows update recovery | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:277 | Failed Prepare during Connecting omits immediate recovery | real-unfixed; #1046 decision record. Earlier release has the same AI-preservation blocker |
| WIN-REPLACEMENT-HEAL-STATE | Windows account | P2 | apps/windows/app/src-tauri/src/tono/commands/account.rs:359 | Replacement sign-in retains prior fallback/history | duplicate of #1047. Our independent test failed before and passed after; duplicate code removed before push |
| FP-DIRECT-CANCEL-LOSES-CLEANUP | Windows DIRECT ownership | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:1335 | Cancelling wait abandons captured-session retraction | false positive; detached owner reconciles before lifecycle reader drops |
| FP-HEAL-CREDENTIAL-LEAK | Windows account privacy | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:359 | Old fallback reuses prior account credentials | false positive; previous catalog/routing discarded, surviving node name uses new account credentials |
| FP-HEAL-RESET-DISARMS-WFP | Windows protection state | — | apps/windows/app/src-tauri/src/tono/connection/heal.rs:36 | Resetting healer protection bit disarms native protection | false positive; advisory recovery state is separate from FSM/Service and recomputed before connection |

Own PR: https://github.com/raydocs/tono/pull/1046 — docs only; needs-hardware; auto-merge deliberately off; final head fe52e17d328438f876f1416335cde2b40630e65c. CI pending at report time. Initial docs-head ci-gate passed, which does not qualify the final head or native recovery.

Duplicate PR: https://github.com/raydocs/tono/pull/1047 — another hunter; needs-hardware; merge-commit auto-merge enabled when checked. We made no changes to that PR/branch.

Checks: P1 exact health-disposition extraction + real Tokio reader/writer failed (0 passed/1 failed, cancelled=false). Update exact FSM helper + real tono-core ConnectionFsm failed (0 passed/1 failed, no release dispatch). Replacement exact adoption/helper/test extraction with real tono-core healer failed before (0 passed/1 failed), passed after (1 passed/0 failed); App/auth/disk/audit fixtures substituted native boundaries. Diff and findings parsing passed. Independent read-only audit confirmed release safety blockers and reset correctness. Raw logs and source harnesses retained in this output directory.

False-positive count: 3. Total hypotheses examined: 6 (3 assigned findings, 3 rejected safety/privacy hypotheses).

Unfinished: implementing both recovery fixes remains blocked by the AI-preserving release contract; native Tauri/Windows WFP/DNS and real-device behavior unavailable in this Linux VM. Focused assigned areas were examined; no broad Windows hunt attempted after the 22:45 MT new-fix cutoff. No deploy, publication, main edit, foreign branch edit, CI-gate weakening, or unsafe network fix.
