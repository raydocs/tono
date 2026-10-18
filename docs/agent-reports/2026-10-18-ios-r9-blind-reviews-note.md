# iOS round 9 blind reviews: implementation note

The files below are the two independent blind reviews of iOS #1672 round 9, together with their evidence files. All are committed **verbatim**; no edits, scores or conclusions are changed. This note is the implementation thread's only addition.

| File | Reviewer | sha256 | How obtained |
|---|---|---|---|
| [2026-10-18-ios-r9-blind-review-opus-5-5.md](2026-10-18-ios-r9-blind-review-opus-5-5.md) | Claude Opus 5.5 (`claude-opus-5-5`), [thread](https://ampcode.com/threads/T-01a14fd1-abd4-7500-89fa-33bdf8a8bdc3) | `6c4b6259a98fa7a032d040f23dfe062cd8355b242b0b258d9e9e48bd132540e6` | Puck's export failed ("No executor connected"). The implementation thread downloaded the reviewer's own file byte for byte with `download_thread_file` (`.amp/in/artifacts/ios-pr1672-r9-blind-review-opus-5-5.md`, 169 lines). It was not rebuilt from a summary. |
| [2026-10-18-ios-r9-blind-review-opus-5-5-artifact-sha256.txt](2026-10-18-ios-r9-blind-review-opus-5-5-artifact-sha256.txt) | Opus evidence list (77 artifact files) | `a1b74dde62a85fbf54c029749a2a0576d3ee8754aceb85809b61a20df0a16eb8` | Downloaded the same way, from `.amp/in/artifacts/pr1672-r9-evidence/artifact-sha256.txt`. The report cites it. |
| [2026-10-18-ios-r9-blind-review-gpt-6-1-sol.md](2026-10-18-ios-r9-blind-review-gpt-6-1-sol.md) | GPT-6.1 Sol (`gpt61s`), [thread](https://ampcode.com/threads/T-01a14fd1-b3db-7313-bdd7-9c761383eff0) | `78d5c9f9abf16cbee4ad3904f36bb075e5f6c0981c63724d941df652db2bf354` | `amp files get` of the temporary file that Puck shared. |
| [2026-10-18-ios-r9-blind-review-gpt-6-1-sol-evidence-inventory.md](2026-10-18-ios-r9-blind-review-gpt-6-1-sol-evidence-inventory.md) | GPT evidence inventory | `a96e1cef0ac647b184027c6242778b4ef95c1ff83b6f8d9219edade765d731d6` | Same as above. |
| [2026-10-18-ios-r9-blind-review-gpt-6-1-sol-evidence-manifest.tsv](2026-10-18-ios-r9-blind-review-gpt-6-1-sol-evidence-manifest.tsv) | GPT evidence manifest | `afbb94d8f5c37ef53c9a6835205c1a957d4271e326d1007ca892b51133460274` | Same as above. |
| [2026-10-18-ios-r9-blind-review-gpt-6-1-sol-verification-receipt.txt](2026-10-18-ios-r9-blind-review-gpt-6-1-sol-verification-receipt.txt) | GPT verification receipt | `de94d57d1503782f2cad425017671216b42734ab39adc8a0132e413f24104fd6` | Same as above. |

The `file:///home/user/workspace/repo/.amp/in/…` links inside the reports point into each reviewer's own sandbox. They are part of the verbatim text and do not resolve here.

## Same baseline

Both reviews scored the same frozen baseline with the unchanged rubric:
- code `b36d07d7907f39364f1cfe4309d60824fea9d24e`; the log tip `8dd22e2` adds only the changelog fragment
- run [39140462842](https://github.com/raydocs/tono/actions/runs/39140462842)
- artifact 12142836958

## Verdicts: two different conclusions, both "not passed"

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Total | **84** | **86** |
| Every item ≥ 70% | yes | yes |
| Total ≥ 85 | **no** | yes |
| Veto | none of the three applies | **applies: serious state misrepresentation** (routing mode) |
| Verdict | **fails on the total** | **fails on the veto** despite the passing number |

The two reviews are not averaged. A mean would hide GPT's veto, and the rubric's veto overrides any total. **Round 9 has not passed under either review, and the target of 95 has not been reached.**

**What the veto rests on.** In GPT's own words, the evidence grade is "源码推导的可达失败路径；未在模拟器或真机注入故障复现，不声称已经测出实网泄漏" (a reachable failure path derived from source; not reproduced by fault injection on a simulator or device; no measured leak is claimed). The path: after a mode switch, the UI shows the new mode and its answers, while a failed save, send or reload leaves the extension running the previous graph.

**Opus saw the same path and weighed it differently.** Its source note S4 describes it: a refused reload leaves the new mode and answers on screen while the extension keeps the old graph. Opus calls this "边缘情况，未在模拟器复现" (an edge case, not reproduced on the simulator) and lists it as suggestion 7 ("回滚 `mode`，或者给查询答案标注"未生效"": roll back `mode`, or mark the answer "not in effect"). Its veto check reads "严重状态误导：未发现" (serious state misrepresentation: none found), judged on the recorded states. So the two reviews disagree on severity, not on the facts of the path.

The implementation thread's source check of this path is recorded in the changelog and the PR. A fault-injection regression is part of the round 10 rework. Until that regression exists, the finding remains source-derived, **not a measured incident**.

## Scores side by side, with the implementer self-score

The implementer's self-score was written before either review arrived: local file, 2026-10-18 16:20 UTC; the reviews were received at 16:44 UTC. Neither reviewer was shown it.

| Item | Max | 70% floor | Opus 5.5 | GPT-6.1 Sol | Spread | Implementer self (not independent) |
|---|---:|---:|---:|---:|---:|---:|
| Hierarchy / few words | 20 | 14 | 17 | 18.5 | 1.5 | 18.5 |
| One-handed | 20 | 14 | 17 | 17 | 0 | 18.5 |
| Restrained quality / desktop brand | 15 | 10.5 | 13 | 13 | 0 | 14 |
| Liquid Glass | 15 | 10.5 | 12 | 13 | 1 | 12.5 |
| State motion | 15 | 10.5 | 13 | 12 | 1 | 14 |
| Accessibility | 10 | 7 | 8 | 8.5 | 0.5 | 8.5 |
| Authenticity / performance | 5 | 3.5 | 4 | 4 | 0 | 3.5 |
| **Total** | 100 | 85 | **84 (fails)** | **86, veto (fails)** | 2 | 89.5 (no veto judged) |

**How the self-score compares**
- The self-score is 3.5–5.5 points above the two reviews.
- It missed the defect behind GPT's veto entirely: the mode-apply failure path.
- Its two largest overestimates:
  - State motion: 14 against 13 and 12. GPT deducts here for the unconfirmed mode switch.
  - One-handed: 18.5 against 17 and 17. Both reviewers deduct because the keyboard covers the bottom edge of the controls, and because the medium sheet puts the query and the mode below the fold.
- On authenticity it is half a point *below* both reviews.
- **The independent reviews do not confirm 89.5, nor any earlier self-score (90.5, 91.5), nor 95.**

## Isolation boundaries (each reviewer's own statement)

**Opus 5.5:**
- Took the rubric only from the PR body's `## Rubric (verbatim, unchanged)` section, extracted with awk.
- Read no other part of the PR body and nothing under `docs/agent-reports/`.
- Saw no other review and no implementer self-score.
- Ran no regression on the old head, so it reports no Red result.

**GPT-6.1 Sol:**
- Extracted only the rubric text from the PR body.
- Read no earlier score, `docs/agent-reports`, earlier review or implementation note, or other blind-review thread.
- Did not ask for or view the implementer self-score.
- Exported source from the locked head only.
- Did not use the changelog's review content.

Neither reviewer saw the other's report. Round 9's self-score existed only in a local file in the implementation orb. It was not in the PR, the repository or any message until this note.

## How the rework uses them

The changes are worked on #1672 in this order:

1. **Investigate the routing-mode apply path first and verify it against the contract.**
   - Separate the desired, applied and pending mode.
   - Answers and lanes must never claim a mode is in effect before the tunnel confirms it.
   - Show an apply error while connected.
   - Fault-injection regressions for save, send and reload rejection.
2. **Opus's three P1s:**
   - a plain description of each mode;
   - separate the gear from Details;
   - feedback for an empty or invalid query, with a UI regression showing that editing the domain clears the answer.
3. **The rest of the union, each verified before it is changed:**
   - text overlapping during crossfades;
   - the keyboard covering the bottom edge of the controls;
   - asserting the real widget's placement;
   - ending the preview Live Activity before the real-widget capture;
   - contrast.

Anything only a device can verify stays listed separately as unverified. Fixes, regressions and the next blind re-review are recorded in `docs/changelog.d/2026-10-17-ios-singbox-horizon.md` and on the PR, not in the reports.
