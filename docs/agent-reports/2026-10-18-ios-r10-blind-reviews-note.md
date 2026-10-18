# iOS round 10 blind reviews: implementation note

The reports and evidence files below are the two independent blind reviews of iOS #1672 round 10, together with the implementer's sealed self-score. All are committed **verbatim**. This note is the implementation thread's only addition.

All six review files were downloaded byte for byte with `download_thread_file` from each reviewer's own workspace. None was rebuilt from a summary. Each sha256 matches the hash Puck supplied and the reviewer's own checksum file.

| File | Source | sha256 |
|---|---|---|
| [2026-10-18-ios-r10-blind-review-opus-5-5.md](2026-10-18-ios-r10-blind-review-opus-5-5.md) | Claude Opus 5.5, [thread](https://ampcode.com/threads/T-01a150c0-0ccd-765d-abdd-920fa5302750), `.amp/in/artifacts/pr1672-r10/REPORT.md` | `081fd607311ffcf3b81439a9fa4a4bede141d83293b664fe8a6aad2fb6c014b3` |
| [2026-10-18-ios-r10-blind-review-opus-5-5-evidence.md](2026-10-18-ios-r10-blind-review-opus-5-5-evidence.md) | the same thread's `EVIDENCE.md` | `c230fd4393e1449dca70dea5a4bec4a9d696075cc52174bb7975205251df3719` |
| [2026-10-18-ios-r10-blind-review-opus-5-5-hashes.txt](2026-10-18-ios-r10-blind-review-opus-5-5-hashes.txt) | the same thread's `hashes.txt` | `0c25508bb2e4cecd14fa6673f3d6966c410ca726c62582c6b6b032ebf2ed7124` |
| [2026-10-18-ios-r10-blind-review-gpt-6-1-sol.md](2026-10-18-ios-r10-blind-review-gpt-6-1-sol.md) | GPT-6.1 Sol, [thread](https://ampcode.com/threads/T-01a150c0-3b5e-71c0-9e42-e9dc495355e5), `.amp/in/artifacts/pr1672-round10/report.md` | `9d3db3f496724be6ce2c3515275d6fdd737fe4b824155a03ac781e9d38e3a389` |
| [2026-10-18-ios-r10-blind-review-gpt-6-1-sol-evidence-inventory.tsv](2026-10-18-ios-r10-blind-review-gpt-6-1-sol-evidence-inventory.tsv) | the same thread's `evidence-inventory.tsv` | `7175cf27cd0ef82c69675f26a2a9bae196f5d1402823d2b7bc3ecfe2adb1d41e` |
| [2026-10-18-ios-r10-blind-review-gpt-6-1-sol-SHA256SUMS](2026-10-18-ios-r10-blind-review-gpt-6-1-sol-SHA256SUMS) | the same thread's `SHA256SUMS` | `29486cc63ad64685873f9567efc7a10577147613318be26890e6588ccbc11bf7` |
| [2026-10-18-ios-r10-implementer-self-score-sealed.md](2026-10-18-ios-r10-implementer-self-score-sealed.md) | implementation orb, `.amp/in/self-score-r10.md`, written 2026-10-18 20:40 UTC | `bfb994c57928651566ca529bf01b55e6b368493e6f2ad94a603fea40620d9202` (the hash given to Puck before the reviews) |

Other files the reports name (raw logs, frames, ZIP, source snapshot) stay in the reviewers' workspaces. Their hashes are in the two checksum files above.

## Same baseline

- code `90822de32f2cad955237b3549e0482369c537eaa`
- run [39160461314](https://github.com/raydocs/tono/actions/runs/39160461314)
- artifact 12150076988

The log tip `16e9b2b` adds only the changelog fragment.

## Verdicts: both not passed, not averaged

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Total | **81** | **86** |
| Every item ≥ 70% | yes | **no** (authenticity 3/5 = 60%) |
| Total ≥ 85 | **no** | yes |
| Veto | **serious state misrepresentation** | **serious state misrepresentation** |
| Verdict | fails (total and veto) | fails (item floor and veto) |

Both vetoes rest on the same source-derived path, which neither reviewer executed. When a reload is refused and the restore of the previous graph also fails, nothing runs. But the extension's heartbeat still writes `running: true`. `StatusSnapshot.fromTunnel` then turns the app's `failed` snapshot into a fresh `.on`, so the widgets and the Control Center switch read Connected again, and keep reading it on every heartbeat.

## Scores side by side, with the implementer self-score

The self-score was written after the green run and before either review. It was sealed by hash and not shown to either reviewer.

| Item | Max | 70% floor | Opus 5.5 | GPT-6.1 Sol | Implementer self (not independent) |
|---|---:|---:|---:|---:|---:|
| Hierarchy / few words | 20 | 14 | 17 | 18.5 | 18 |
| One-handed | 20 | 14 | 16 | 17 | 17.5 |
| Restrained quality / desktop brand | 15 | 10.5 | 13 | 13.5 | 13.5 |
| Liquid Glass | 15 | 10.5 | 12 | 13 | 12.5 |
| State motion | 15 | 10.5 | 11 | 13.5 | 13.5 |
| Accessibility | 10 | 7 | 8 | 7.5 | 8.5 |
| Authenticity / performance | 5 | 3.5 | 4 | **3** | 4 |
| **Total** | 100 | 85 | **81, veto** | **86, veto, floor** | 87.5 ("veto judged fixed") |

**How the self-score compares**
- It is 1.5–6.5 points above the reviews.
- It judged the veto path fixed. Both reviews found the heartbeat path, which the self-score missed entirely.
- It scored authenticity 4. GPT scored it 3, below the floor.
- **The independent reviews do not confirm 87.5, 95, or any earlier self-score.**

## Isolation boundaries (each reviewer's own statement)

- **Opus:**
  - Extracted only the PR body's Rubric section and deleted the rest unread.
  - Did not read the changelog delta, the comments, `docs/agent-reports`, other reviews or the self-score.
  - Did not contact the implementation thread.
- **GPT:**
  - Extracted only the Rubric section.
  - Did not read the other score sections, comments, other review threads, `docs/agent-reports` or the sealed self-score.
  - Used no oracle and no delegated reviewer.
- Neither reviewer saw the other's report.

## How the rework uses them

1. **F1 (both reviews):** after a failed restore, the shared status must stay failed across heartbeats. Regression tests must run through the heartbeat, the shared snapshot and the widget/control presentation, not only the app.
2. **The union of both reviews' other findings:**
   - **No reply:** this does not prove the previous graph still runs; the state is unconfirmed until the tunnel reports.
   - **Swallowed rollback write:** a failed rollback write is swallowed, which leaves the refused choice on disk for On Demand.
   - **Wrong reason during reload:** an app-requested reload shows "Network changed" and Cancel.
   - **Stale Home note:** Home's route note does not check that the request differs from what is in effect.
   - **No pending line:** a line change shows nothing pending on Home.
   - **Contrast coverage:** the after-audit re-measure needs its own large-text and Lines coverage, with no loosening of the audit.
3. **Kept as the reviewers wrote it:**
   - The real widget evidence shows "Status unavailable" only; it is not live evidence.
   - Device behaviour stays unverified and is not counted as confirmed.

Fixes and the next blind re-review are recorded in `docs/changelog.d/2026-10-17-ios-singbox-horizon.md` and on the PR.
