Reviewed **107 Windows PRs**. Three regressions merged through CI; **main still has a verified P1 retry-loop regression from #714**.

Paths below are relative to `apps/windows/`: **S** = `service/src`, **A** = `app/src-tauri/src/tono`, **F** = `app/src`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R3REGW-FRESH-ARM-READBACK | WFP proof | P1 | S/core/windows_kill_switch.rs:4074 | Inherited verification acknowledges an undelivered fresh mark | Fixed in [#1037](https://github.com/raydocs/tono/pull/1037) |
| R3REGW-UPDATE-DISCONNECT-AI-HOLD | Update cleanup | P1 | S/core/update.rs:646 | Automatic pending-update cleanup loses AI-hold intent | Fixed in [#1040](https://github.com/raydocs/tono/pull/1040) |
| R3REGW-DIRECT-DOUBLE-HOLD | DIRECT expiry | P2 | S/core/windows_kill_switch.rs:3661 | Duplicate application removes the newly installed AI hold | Fixed in [#1044](https://github.com/raydocs/tono/pull/1044) |
| R3REGW-UNARMED-CONNECT-BACKOFF | Reconnect | P1 | A/connection/unarmed_probe.rs:157 | Failed full connections immediately retry when TCP succeeds | Real-unfixed; discovered after cutoff |
| R3REGW-PROTECTED-TCP-PROOF | Policy reconnect | P2 | A/connection.rs:440 | Retained WFP blocks the App’s TCP preflight | Real-unfixed; native reproduction outstanding |
| R3REGW-SELECTIVE-NETSH-PATH | AI IP hold | P2 | S/core/selective_fail_open.rs:106 | Hardcoded C-drive executable fails on alternate system drives | Real-unfixed; discovered after cutoff |
| R3REGW-RECOVERY-PUBLICATION-FLOOR | Update recovery | P2 | S/bin/install_service/update_executor.rs:376 | Early recovery return bypasses publication-floor recording | Real-unfixed; narrow timing, native exposure unverified |
| R3REGW-ROLLBACK-DOUBLE-HOLD | Update rollback | P2 | S/bin/install_service/update_executor.rs:622 | Restart failure repeats an already successful AI hold | Real-unfixed; requires two failures |
| R3REGW-AI-TALLY-ACCOUNT-SCOPE | AI tally | P2 | F/tono-ui/AiTrafficCard.tsx:48 | Cached prior-account tally renders during replacement read | Real-unfixed; component test reproduced |
| R3REGW-AI-TALLY-SEEN-GROWTH | AI tally | P3 | F/tono-ui/AiTrafficCard.tsx:28 | Historical flow receipts grow until controller changes | Real-unfixed; no OOM/hang demonstrated |

All three own PRs **merged with merge commits**, passed applicable CI, and retain `needs-hardware`; auto-merge was enabled. Combined main checks passed **111 WFP + 2 update-operation + 2 selective-worker tests**. Existing focused frontend tests passed **29**; two audit tests reproduced the tally findings.

**40 distinct hypotheses:** 3 fixed, 7 unfixed, **27 rejected**, and 3 duplicates/known limitations. Duplicates were catalog cleanup #1036, DNS snapshot rewrite #982, and the known Connecting limitation from #787.

The [full report](/workspace/w1-codex/out/R3-RegWin/report.md) contains every PR row, rejection reason and proof limit. [findings.tsv](/workspace/w1-codex/out/R3-RegWin/findings.tsv) and [prs.tsv](/workspace/w1-codex/out/R3-RegWin/prs.tsv) are updated.

Remaining coverage: physical Windows acceptance, exhaustive untouched installer/security helpers, dependency internals, and merges after the approximately **22:47 MT** inventory cutoff. Late findings remain unfixed under the explicit **22:45 cutoff for starting fixes**.

Hunter: GPT-6.1 Sol (Codex CLI)