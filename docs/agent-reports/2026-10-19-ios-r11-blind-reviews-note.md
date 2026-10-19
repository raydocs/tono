# iOS round 11 blind reviews: implementation note

The files below are the two independent blind reviews of iOS #1672 round 11, their evidence or checksum files, and the implementer's sealed self-score. All are committed **verbatim**. The GPT report is kept as the original HTML. This note is the implementation thread's only addition.

Each file was downloaded byte for byte with `download_thread_file` from the reviewer's own workspace; none was rebuilt from a summary. The report hashes match the ones Puck supplied, and GPT's `report.html` and `contrast-results.json` also match the lines in its own `SHA256SUMS`.

| File | Source | sha256 |
|---|---|---|
| [2026-10-19-ios-r11-blind-review-opus-5-5.md](2026-10-19-ios-r11-blind-review-opus-5-5.md) | Claude Opus 5.5, [thread](https://ampcode.com/threads/T-01a151ed-218d-747c-a8b5-d771eb7f34ab), `.amp/in/artifacts/pr1672-r11-blind-review.md` | `e4465877b1371dad4bfb7747727e0469366fb175eec95e6c6d5b51e1b099ff35` |
| [2026-10-19-ios-r11-blind-review-opus-5-5-evidence-sha256.txt](2026-10-19-ios-r11-blind-review-opus-5-5-evidence-sha256.txt) | the same thread's `r11-evidence-sha256.txt` | `4962c411713c10502bdd7237a0c5d8f708bd5eb4ec74b53b0accfafb92c7b20e` |
| [2026-10-19-ios-r11-blind-review-gpt-6-1-sol.html](2026-10-19-ios-r11-blind-review-gpt-6-1-sol.html) | GPT-6.1 Sol, [thread](https://ampcode.com/threads/T-01a151ed-63e7-70fa-9887-128402ba92cf), `.amp/in/artifacts/pr1672-r11/report.html` | `da038d8207e1ebf5aac692af4fc12388a2d5e79785c0d670d401fc00201a0f9e` |
| [2026-10-19-ios-r11-blind-review-gpt-6-1-sol-SHA256SUMS](2026-10-19-ios-r11-blind-review-gpt-6-1-sol-SHA256SUMS) | the same thread's `SHA256SUMS` | `7fdd9a87fcfe3b649265194b0ef1177b2543cc97ad23b558f39ac8b92ecc56a0` |
| [2026-10-19-ios-r11-blind-review-gpt-6-1-sol-contrast-results.json](2026-10-19-ios-r11-blind-review-gpt-6-1-sol-contrast-results.json) | the same thread's `analysis/contrast-results.json` | `e269e2cef1be66940cca17abfb8b3773e2b08b34c9ea2b3952a87579a9281056` |
| [2026-10-19-ios-r11-implementer-self-score-sealed.md](2026-10-19-ios-r11-implementer-self-score-sealed.md) | implementation orb, `.amp/in/self-score-r11.md`, written 2026-10-19 after run 39184374749 | `bedebcfb837d77e3106b923ff0cb283af3d76cd3c45fa0b3c66fe8b2657c697d` (the hash given to Puck before the reviews) |

Other files the reports name (raw CI logs, artifact ZIP, frames, source snapshot, scripts) stay in the reviewers' workspaces. Their hashes are in the two checksum files above.

## Same baseline

Both reviews scored the same frozen baseline with the unchanged rubric:
- code `c2f8762977360d8f2c953bf787651b8c5ad825df`; the tip `f63a947` adds only the changelog fragment
- run [39184374749](https://github.com/raydocs/tono/actions/runs/39184374749)
- artifact 12159295214

## Verdicts: neither passes, not averaged

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Total | **83.5** | **84** |
| Every item ≥ 70% | yes (a11y 7/10 and authenticity 3.5/5 sit exactly on the floor) | **no**: accessibility 6.5/10 = 65% |
| Veto | none | **applies: serious state misrepresentation** (F2, unknown routes shown as current) |
| Verdict | **fails on the total** | **fails on the total, the floor and the veto** |

| Item | Max | Opus | GPT | Implementer self (sealed, not independent) |
|---|---:|---:|---:|---:|
| Hierarchy / few words | 20 | 18 | 18 | 18 |
| One-handed | 20 | 17.5 | 17 | 17 |
| Restrained quality / desktop brand | 15 | 12.5 | 14 | 13.5 |
| Liquid Glass | 15 | 12 | 13 | 12.5 |
| State motion | 15 | 13 | 12 | 13 |
| Accessibility | 10 | 7 | 6.5 | 8.5 |
| Authenticity / performance | 5 | 3.5 | 3.5 | 3.5 |
| **Total** | 100 | **83.5 (fails)** | **84, floor, veto (fails)** | 86 (no veto judged) |

**How the self-score compares.** It is 2–2.5 points above the reviews. Its largest error is accessibility (8.5 against 7 and 6.5): it trusted the new glyph-core measurement. Both reviewers recomputed the Cancel label on the Preparing / Connecting gradient capsule from the original PNGs and found it below 4.5:1, which the CI method had passed at 4.8:1. It also missed GPT's veto path: unknown routes still described as current in "Where traffic goes". **The independent reviews do not confirm 86, nor 95.**

**Points both reviewers accept:**
- The old 97th-percentile explanation for Details' Settings row holds (1.1887 against 15.268 on the original capture).
- The round-10 "audit race" explanation is not needed and has no independent evidence.
- The calibration probe really ran (3.3 / 4.4 / 16.2), but it covers only flat backgrounds.
- 172 is a count of element visits, not of unique, fully visible controls.
- `ci-gate` does not include iOS.
- The TunnelGraph chain test's "file" is an in-memory variable.
- The gallery is not the extension.
- The real system widget still shows "Status unavailable".
- The NE fault chain, a device and VoiceOver are not verified.
- No mutation-red or stub-typecheck raw logs were available to them, so those claims are not accepted as executed.

## Isolation (each reviewer's own statement)

- **Opus 5.5:** read the fixed source, the raw CI job logs, the artifact and only the PR body's verbatim Rubric section. It read no earlier score, review, implementation thread, self-score or agent-reports.
- **GPT-6.1 Sol:** read the fixed source, the named raw CI and artifact, and only the Rubric section of the PR. It read no earlier score, review or implementation thread, sealed self-score, agent-reports or other PR text or comments. It created no sub-thread and did not contact the implementer.

## How the rework uses them

Round 12 works on the union, each item verified against source first:
1. Cancel on the Preparing / Connecting fill: fix the UI itself, measure label glyphs against their local background, and cover Preparing. No threshold change.
2. Unknown routes: every route, exit and lane statement stays conservative while unconfirmed, with a screenshot regression.
3. App / tunnel status writes: no stale app write may override the tunnel's routes-stopped verdict, in either direction. Add cross-process fault evidence on a real shared file.
4. Put-back obligation: it must not be dropped when a later save also fails.
5. Raw receipts for mutation red and the stub typecheck, or the claims downgraded.
6. Honest sweep counts.

Anything only a device can verify stays listed as unverified.
