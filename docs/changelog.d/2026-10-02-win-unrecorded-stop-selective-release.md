## 2026-10-02 · A kept Windows session whose Core cannot be restarted releases with the AI hold
- Ownership: SHIP_PLAN §2 item 10 (decision 031); Windows Service stop path (`WIN-UNRECORDED-STOP-NONSTRICT-HOLD`, [#1139](https://github.com/raydocs/tono/issues/1139)).
- Source: baseline `4da6e98c`; branch `fix/win-unrecorded-stop-release-1139`, [#1327](https://github.com/raydocs/tono/pull/1327); not yet merged.
- Defect fix: `StopClash` without release (policy rebuild, protected reconnect) confirmed the Core stop, failed to record it, and could not restart the still-wanted Core. The Service restored DNS and kept the non-strict barrier. An already verified arm has no proof deadline and the stopped Core has no watchdog, so nothing in the Service ever opened it; only the App's next failed Connect did (through #1295). With the App gone or stuck the machine stayed Blocked. Now `recover_after_unrecorded_stop` queues the existing epoch-fenced retirement (`note_core_recovery_exhausted`), and the next WFP watchdog tick runs `retire_expired_fresh_arm`: run intent retired, general traffic opened, AI hold kept.
- Kept: strict mode keeps its barrier (the queue is a no-op for strict). A successful restart is unchanged. A successor Connect arms a new epoch, which revokes the queued retirement. The release is not gated on the DNS-restore verdict, but that error is still returned to the handler as before.
- New/optimization: none.
- Engineering/tests: `an_unrecorded_stop_that_cannot_restart_queues_the_selective_release` replaces `an_unrecorded_stop_restores_dns_without_dropping_the_barrier`, which asserted the retained barrier (the #930 choice this change supersedes for non-strict). The test commit was pushed alone first so hosted CI ran it against the old code.
- Verification: no local cargo on the MacBook; Windows CI runs the test. See the PR for the red run on the test-only commit and the green run on the fix.
- Candidate/publication: source only; no new candidate.
- Limits: needs-hardware (no full-disk reproduction on a Windows machine). The release waits for the WFP watchdog tick (1 s). A restart that fails but leaves a live Core is not queued; its own Core watchdog owns that case.

### 2026-10-02 continuation: merged to main
- Merged: #1327, merge commit `927a1f33`, PR head `2b2a31e3`. `ci-gate` green on that head: https://github.com/raydocs/tono/actions/runs/37000467745 .
- Independent review (Codex `gpt-6.1-sol`, high): rounds, findings and dispositions are recorded in https://github.com/raydocs/tono/pull/1327#issuecomment-5951819840 ; its one major is the behaviour Decision 031 asks for and is recorded there as not a defect.
- Candidate/publication: source merged to main only. No new package, no deploy, no customer publish. No hardware verification.
