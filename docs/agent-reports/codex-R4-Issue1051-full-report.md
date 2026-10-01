# R4-Issue1051 — GPT-6.1 Sol (Codex CLI)

Status: stopped at the top-rule blocker. No runtime changes, commit, push or PR. Branch `hunt/sol-r4i1051-ai-preserving-release` remains at baseline `89a0e0e7`; worktree is clean. #1051 had no prior claim; posted only `Taking this (Codex Sol)` at https://github.com/raydocs/tono/issues/1051#issuecomment-5925201358.

| ID | area | severity | file:line | description | verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows App | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Automatic health cleanup does not cancel the stalled DIRECT lifecycle reader, delaying release dispatch. | real-unfixed #1051: cancellation opens the unproven AI-hold transition sooner; top-rule blocker |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows App | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:277 | Failed Prepare only releases Connected, folding an armed Connecting attempt without immediate recovery. | real-unfixed #1051: same AI-preserving release contract needed |
| R4I1051-AI-RELEASE-PROOF | Windows Service | — | apps/windows/service/src/core/selective_layer.rs:61 | Existing narrow-release request returns without installation proof, after removing general protection. | duplicate of #1046's recorded blocker; no new bug claim |

## Evidence

Linux Rust 1.98.1, `CARGO_BUILD_JOBS=2 cargo test --manifest-path /workspace/w1-codex/out/R4-Issue1051/proof/Cargo.toml --lib issue1051 -- --nocapture`: **0 passed, 3 failed, 0 ignored**, as expected on unmodified production behavior. Raw log: `issue1051-proof.log`. Generator: `build-proof.py`; generated Cargo.lock and source are retained under `proof/`.

- Exact production automatic-health closure and helper plus exact production `wait_direct_controller`, using a portable state facade and real Tokio cancellation/RwLock: `cancelled=false; writer_dispatched=false` after 200 ms. Cleanup releases the test reader before asserting. This proves the closure does not retire the token; it does not run Tauri, native Service cleanup, or literal Core HTTP.
- Exact production `quiesce_connection_after_update` with the real portable `tono-core::connection::ConnectionFsm`: current armed Connecting with `core_running=Some(true)` and failed Prepare returns false rather than requesting recovery.
- Copy of the entire unchanged production `selective_layer.rs` with one added diagnostic regression using its existing paused-native fixture: the selective request returns at its six-second budget while installation is still paused and the hold is absent. This proves missing completion proof; it does not prove Windows firewall/registry effectiveness.

Source ordering: `windows_kill_switch.rs:2799–2800` restores DNS then removes all general provider filters; `:2848` requests the AI hold afterward. `selective_layer.rs:83–85` deletes the old narrow hold before adding it, `:61–71` discards timeout, and native `:140–143` / `:290–291` only log application errors. `dns/engine.rs:1904–1912` performs separate fallible registry writes with no readback.

## Precise blocker and rejected remedies

The existing `apply_narrow_layer=true` release is not an atomic or proven AI-preserving release. A protocol addition can expose checked preinstallation, but cannot make separate native firewall/NRPT failures disappear. On a refused or hung installation, returning an error adds a new prerequisite that retains the complete network block; continuing restores general internet without an AI hold. Each choice violates an explicit part of the user's top rule. The original stalled controller is one failure; a native installation failure is a second independent failure, but that does not authorize introducing the prohibited tradeoff.

Rejected remedies (not additional bug findings):

1. Cancellation alone: advances WFP removal before the hold is proven.
2. Calling the existing `finish_release(true)` earlier: no success proof; its timeout can return while mutation is still running, and calling it again after release deletes/re-adds the hold.
3. Checked preinstall: successful ordering is possible, but error disposition is the availability-versus-AI tradeoff above.
4. Leaving the current narrow rules installed in normal operation: selective NRPT suffixes are more specific than the protected `.` catch-all, and current global outbound netsh rules can veto legitimate tunneled Claude traffic. It cannot be assumed harmless from Linux fixtures.

A plausible larger backend design would prearm per-suffix NRPT pointing at the protected Core resolver, plus static Anthropic filters below the TUN permit in the same WFP sublayer; automatic release would atomically remove only general filters and retain the already-proven hold. It requires changes to admission/bootstrap, the exact filter model, tombstone disposition/startup recovery, explicit Restore/update cleanup and compatibility. Today `wanted:false` startup sweeps every provider filter (`windows_kill_switch.rs:3299–3313`), so simply retaining filters at disarm is insufficient. Native DNS/TUN/WFP qualification is also required. This exceeds a small protocol/release-order fix and is a decision item under the user’s instructions.

App follow-ups, if a backend is designed: use abort-free `retire_connection_generation(false)` guarded by expected generation plus Connected; `invalidate_connection(false)` can abort the calling monitor before registration. Use false stale-release intent for automatic failed-Prepare cleanup; include current Connecting when the service proves a live Core, even before the local armed latch is set; bypass idle early-return for this expected-generation cleanup. DIRECT commit's later read-only controller proofs also need captured-token cancellation. No partial patch was shipped.

## Delivery / limits

- PRs: none; auto-merge and labels: not applicable.
- False-positive bug count: 0. Three hypotheses examined: two verified issue defects and one confirmation of the already-recorded backend blocker. Four proposed remedies rejected as above.
- Unfinished: runtime fix for #1051; native Windows App/Service/WFP/DNS tests unavailable in this Linux VM. No claim of native reproduction, successful fix, CI qualification or hardware acceptance.
- No new issue or docs-only PR: findings already belong to #1051/#1046. Operator notes prohibit any comment beyond the one claim, so the precise blocker is retained here and in the final report instead of a follow-up issue comment.

Hunter: GPT-6.1 Sol (Codex CLI)
