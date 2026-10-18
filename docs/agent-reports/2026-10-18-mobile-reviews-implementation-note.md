# Mobile independent reviews, 2026-10-18: implementation note

The four files below are the two independent blind reviews of iOS #1672 and Android #1673 and their evidence lists, committed **verbatim** as delivered by the coordinating Puck thread (downloaded with `amp files get`; no edits, scores or conclusions changed). This note is the implementation thread's only addition.

| File | Reviewer | Score | sha256 |
|---|---|---|---|
| [2026-10-18-mobile-opus-5-5.md](2026-10-18-mobile-opus-5-5.md) | Claude Code `claude-opus-5-5` | iOS 83, Android 79.5 | `4bf68d13913ca090e95591a733ec15933c9ef64abd47ead333a6e4dd4eb6107a` |
| [2026-10-18-mobile-opus-5-5-evidence.md](2026-10-18-mobile-opus-5-5-evidence.md) | evidence list for the above | — | `868f1547e76e5ba6218c2e7a195614d7eee5c98372635d66b716086be3f9d2b3` |
| [2026-10-18-mobile-gpt-6-1-sol.md](2026-10-18-mobile-gpt-6-1-sol.md) | GPT-6.1 Sol | iOS 83, Android 83 | `cf82a44955439d0f168ca4bd53fe3b04e2bc62286139cf36c517cab0ad562fd9` |
| [2026-10-18-mobile-gpt-6-1-sol-evidence.json](2026-10-18-mobile-gpt-6-1-sol-evidence.json) | evidence inventory for the above | — | `f4c005bbafbabbe69eb7c69a23cf165bc3438d7b5bf2c89c3ef0b635180baaac` |

## Not a same-baseline A/B

The two reviews had different evidence cutoffs and saw different heads and runs, so their scores are not a strict A/B comparison:

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Evidence cutoff | 2026-10-18 07:19:08 UTC | 2026-10-18 06:46:05 UTC |
| iOS head scored | `159ebad`, run 39103718199 **finished, 14/15** (sheet-settings text-field audit red), artifact 12127933792 | visuals anchored on last green `1b7e983`, run 39099937341 (15/15), artifact 12126403272; `159ebad` run still **in progress** at cutoff, its changes treated as code-only |
| Android head scored | `c53eba6`, run 39105266597 (incomplete: DEVICE-OFFLINE, `l1` not run) | `ddc3d343f`, run 39103789541 (20/21, `s1` tile subtitle) cross-checked with green `0a65ffd` |

The Puck links to the files expired at 10:23 UTC (Opus) and 09:49 UTC (GPT); the hashes above are of the copies downloaded before then.

## How the iOS rework uses them

The union of both reports' iOS suggestions is worked on #1672, items both reviewers raised first; product-contract items are checked against existing decisions before changing behaviour (for example, whether Connect stays tappable while offline). Fixes, regressions and the re-score after a green CI are recorded in `docs/changelog.d/2026-10-17-ios-singbox-horizon.md` and on the PR, not in the reports.
