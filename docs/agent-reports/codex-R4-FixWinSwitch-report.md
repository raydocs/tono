Four verified findings fixed across five PRs. All five merged through CI using merge-commit auto-merge and carry `needs-hardware`. Corrected Windows CI passed **628 Tauri tests**.

File names below refer to the Windows connection area unless otherwise shown.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4-WIN-STALE-HEALTH-RELEASE | Health/switch | P2 | monitor.rs:1397 | Old proof releases a successful replacement, including A→B→A | Fixed in [#1133](https://github.com/raydocs/tono/pull/1133) and [#1150](https://github.com/raydocs/tono/pull/1150) |
| WIN-UNARMED-TIMEOUT-OWNER | Recovery | P2 | unarmed_probe.rs:159 | Own Connect timeout ends automatic recovery | Fixed in [#1138](https://github.com/raydocs/tono/pull/1138) |
| R4FO-WIN-EXPLICIT-RELEASE-JOIN-AI-HOLD | Disconnect | P2 | disconnect.rs:143 | Joining automatic release loses explicit remove-AI intent | Fixed in [#1142](https://github.com/raydocs/tono/pull/1142) |
| R4-WIN-LATE-RELEASE-RECOVERY | Release | P2 | disconnect.rs:62 | Successful cleanup after 55 seconds loses recovery | Fixed in [#1156](https://github.com/raydocs/tono/pull/1156) |
| R4-WIN-UNARMED-SELECTION | Recovery | P2 | unarmed_probe.rs:124 | Late proof overwrites newer selection | Duplicate of merged #1098 |
| WIN-UNRECORDED-STOP-NONSTRICT-HOLD | Policy recovery | P1 | monitor.rs:1478 | Persistent write failure retains global WFP after Core stop | Duplicate of #1139; product decision required |
| FP-HEALTH-GENERATION | Health/switch | — | tono/commands/catalog.rs:294 | Generation fence already covers hot switches | Rejected: hot switches preserve generation |
| FP-HEALTH-TERMINAL | Health | — | monitor.rs:1162 | Discarded proof should terminate monitoring | Rejected: replacement monitor must continue |
| FP-TIMEOUT-REPLACEMENT | Recovery | — | unarmed_probe.rs:33 | Failure already spawns replacement recovery | Rejected: task-local suppression prevents replacement |
| FP-RELEASE-IDLE-PROOF | Disconnect | — | disconnect.rs:377 | Idle status proves AI hold absent | Rejected: separate AI hold; #1112 covers dispatch |
| FP-RELEASE-FLAG-SEAL | Release | — | tono/state.rs:788 | A flag alone preserves late removal intent | Rejected: registration and sealing need one atomic check |
| R4-FWS-FP-ROLLBACK | Switch | — | switch.rs:285 | Late rollback mutates successor | False positive: lifecycle writer and owner proof exclude it |
| R4-FWS-FP-DIRECT-DEADLOCK | Switch | — | stages.rs:435 | Startup awaits DIRECT while holding policy writer | False positive: activation is spawned |
| R4-FWS-FP-PIN-ADOPTION | Monitor | — | monitor.rs:452 | Old DNS response adopts another account’s state | False positive: public hostname pins; generation checked |
| R4-FWS-FP-COLD-HOLD | Switch | — | switch.rs:384 | Ordinary failed cold switch retains global block | False positive: non-strict failure requests AI-held release |
| R4FWS-FP-SAMPLER | Recovery | — | unarmed_probe.rs:268 | Hung native sampler threads accumulate | False positive: process-wide semaphore limits workers |
| R4FWS-FP-TCP-BUSY | Recovery | — | core/unarmed_probe.rs:87 | Unreachable exits cause a busy retry loop | False positive: capped backoff returns Wait |
| R4FWS-FP-STALE-CONNECT | Recovery | — | connection.rs:385 | Stale TCP proof admits connection | False positive: selection and generation admission checks |
| R4FWS-FP-ARMED-TCP | Recovery | — | unarmed_probe.rs:355 | WFP blocks protected App TCP recovery proof | False positive: armed recovery bypasses that proof |
| R4FWS-FP-HY2-TCP | Recovery | — | unarmed_probe.rs:195 | HY2 recovery relies on TCP | False positive: HY2 excluded; explicit Connect bypasses preflight |

**Counts:** 20 hypotheses examined; 14 false positives/rejected guard or design hypotheses; two duplicates. The health timing windows count as one finding.

Assigned source audit complete. Real-device WFP/DNS, crash and update acceptance remain untested here. The health test compilation failure was corrected and its subsequent native CI passed.

[Full report](/workspace/w1-codex/out/R4-FixWinSwitch/report.md), [PR tracking](/workspace/w1-codex/out/R4-FixWinSwitch/prs.tsv), [findings](/workspace/w1-codex/out/R4-FixWinSwitch/findings.tsv).

Hunter: GPT-6.1 Sol (Codex CLI)