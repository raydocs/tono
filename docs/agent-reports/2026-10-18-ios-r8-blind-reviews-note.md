# iOS round 8 blind reviews: implementation note

The two files below are the two independent blind reviews of iOS #1672 round 8, committed **verbatim**; no edits, scores or conclusions are changed. This note is the implementation thread's only addition.

| File | Reviewer | Score | sha256 | How obtained |
|---|---|---|---|---|
| [2026-10-18-ios-r8-blind-review-opus-5-5.md](2026-10-18-ios-r8-blind-review-opus-5-5.md) | Claude Opus 5.5 (`claude-opus-5-5`), [thread](https://ampcode.com/threads/T-01a14f54-a1f6-77d2-85d7-bc1e832e223d) | **83** | `301f7acc55a8d95c9d896f5df965bc48eaa79691a0f41921ea1e9915d8edcc17` | Puck's export failed ("No executor connected"). The implementation thread downloaded the reviewer's own report file byte for byte from that thread's workspace (`.amp/in/artifacts/2026-10-18-ios-r8-blind-review-opus-5-5.md`, 148 lines) with `download_thread_file`; not rebuilt from the summary. |
| [2026-10-18-ios-r8-blind-review-gpt-6-1-sol.md](2026-10-18-ios-r8-blind-review-gpt-6-1-sol.md) | GPT-6.1 Sol (`gpt61s`), [thread](https://ampcode.com/threads/T-01a14f54-af5f-7676-94e0-127700260bf1) | **87.5** | `834953441c12592ffd8f4f91c94135b27b4334174fe1a202c7beacc3b506ed37` (matches the hash Puck supplied) | `amp files get` of the temporary file Puck shared. |

## Same baseline

Both reviews scored the same frozen baseline with the unchanged rubric, so the two scores are a same-baseline comparison (round 6's two reviews were not):
- code `217eb1e434cdbf92a7eb2312959d3e0cfdabc1e4`; the log tip `f7b7ddd` adds only the changelog fragment
- run [39130734441](https://github.com/raydocs/tono/actions/runs/39130734441)
- artifact 12139096378

## Scores side by side, with the implementer self-score

The implementer's self-score was written before either review (local file, 2026-10-18 14:03 UTC) and was not shown to either reviewer.

| Item | Max | 70% floor | Opus 5.5 | GPT-6.1 Sol | Spread | Implementer self (not independent) |
|---|---:|---:|---:|---:|---:|---:|
| Hierarchy / few words | 20 | 14 | 17 | 18 | 1 | 19.5 |
| One-handed | 20 | 14 | 16 | 18 | 2 | 19 |
| Restrained quality / desktop brand | 15 | 10.5 | 13 | 14 | 1 | 14.5 |
| Liquid Glass | 15 | 10.5 | 12 | 11.5 | 0.5 | 13 |
| State motion | 15 | 10.5 | 13 | 14 | 1 | 13.5 |
| Accessibility | 10 | 7 | 8.5 | 8.5 | 0 | 8.5 |
| Authenticity / performance | 5 | 3.5 | 3.5 | 3.5 | 0 | 3.5 |
| **Total** | 100 | 85 | **83 (fails)** | **87.5 (passes)** | 4.5 | 91.5 |

**Reading the difference**
- The reviews disagree most on one-handed use (16 vs 18). Opus also deducts for:
  - the medium-detent Details placing the route check and the Settings row below the fold;
  - the orange Connect while offline.
- On hierarchy (17 vs 18), Opus deducts for the routing mode appearing in both Details and Settings and for TCP/UDP jargon.
- Liquid Glass is the only item where GPT is lower (11.5 vs 12). GPT also deducts for the thick smoke under the Lines/Details sheets.
- Both reviews agree on:
  - authenticity sits exactly at its floor (3.5);
  - accessibility is 8.5;
  - the top defect is R8-1: after submitting, the route check answer is hidden under the keyboard. The test only asserted that the answer exists, so CI stayed green.
- **The independent reviews do not confirm the implementer's 91.5, round 7's 90.5, or 95.** The self-score was 4–8.5 points above them and missed R8-1. The independent mean is 85.25: one review passes and one fails.

## Isolation boundaries

- **Opus 5.5**, by its own statement: while locating the rubric, a grep returned PR body line 72. That line carries the **round 7** implementer self-score (90.5, described as an unreviewed self-score). Opus says the number did not inform its score. It could not have seen a round 8 self-score: that score existed only in a local file of the implementation orb, not in the PR, the repository or any message.
- **GPT-6.1 Sol** states that it took only the rubric from the PR body and read no earlier review scores or conclusions, no other review, and no implementer self-score.
- Neither reviewer saw the other's report.

## How the rework uses them

The union of both reports is worked on #1672, highest priority first:
- R8-1: dismiss the keyboard and show the answer; the test asserts it is actually visible; VoiceOver announcement.
- A stale answer after the domain or mode changes. This is GPT code-only; verify it first.
- The repeated ellipse highlight and the thick smoke.
- The include-all "next connection" note. This is code-only; check it against the product contract first.
- The duplicated routing mode.
- The reconnecting sun brighter than partly working.

Fixes, regressions and the next blind re-review are recorded in `docs/changelog.d/2026-10-17-ios-singbox-horizon.md` and on the PR, not in the reports.
