# Fix bake-off: Codex (GPT-6.1 Sol, local CLI) vs GLM-5.3 vs Cursor cloud agents — raydocs/tono, 2026-09-30

This work was read-only on GitHub: nothing was pushed, commented on, merged or opened. All times are MDT unless marked Z (UTC).

Artifacts:
- GLM: raw diffs `glm/{A,B,D,E}.diff`, the diffs as applied `glm/*.applied.diff`, prompts `glm/prompts/`, raw outputs `glm/raw/`.
- Local branches `glm/A|B|D|E` in this clone.
- Codex PR diffs: `codex/pr75{3..7}.diff`.
- Cursor and other CI data: `data/` (`summary2.json`, `table_cursor.md`, `table_glm_prs.md`, `table_codex_prs.md`).

## 1. Head-to-head per bug

Both tools got the same task text: the orchestrator's `codex-prompts/{A,B,D,E}.md` plus the shared rules. GLM got hand-selected source files (excerpts for A and the final B run). Codex worked in a full worktree and could run cargo.

| Bug | Tool | Applies? | Builds / type-checks (Linux) | Tests | Correctness / regression risk |
|---|---|---|---|---|---|
| **A** Win startup release retry + persistent floor + `mark_verified` | Codex #753 (+296/−52, 8 files) | PR | `cargo test --lib` (standalone,client,test) **340/340**; clippy error count equals baseline (28 pre-existing, toolchain drift) | +retry test, stricter persistence test; **ci-gate green on first push** | Correct. Retry is guarded (Drop guard, flag retired under the WFP lock). Namespace bumped to v12. Also fixed the now-false reboot text in `uninstall_service.rs` and the README. Low–medium risk: all floor filters are re-keyed on upgrade (the documented procedure). |
| A | GLM-5.3 | **No (strict).** Wrong hunk counts. Applies with `--recount` except 1 doc-comment hunk (misquoted wrapping), which I applied by hand | Compiles; **339/339** (base 899f7a88 = 338); clippy count equals baseline | +retry test, stricter replacement test; both pass | Same design as Codex, correct. Nits: the running flag is reset outside the lock and has no panic guard (negligible); the test doesn't assert the filters were cleared; the stale `uninstall_service.rs` message stays, because that file wasn't in its context. |
| **B** Win DNS GUID case (+`::1` residue) | Codex #754 (+69/−17) | PR | **339/339** | +1 test with negative cases; ci-gate green first push | B1 correct: `same_adapter_guid` at the 4 sites (and 3 existing sites refactored to use it). B2: deliberately **no change**, documented (a user's `::1` resolver can't be told apart from residue). Low risk. |
| B | GLM-5.3 | **No (strict).** Hunk counts wrong; applies with `--recount` | **343/343** on current main (baseline 342) | +1 test; **I verified it fails without the fix** | Same 4 sites, same helper, same B2 no-change reasoning (thorough). It also explicitly cleared `note_live_results` (mod.rs:2323), which Codex didn't discuss. Low risk. It took 3 paid attempts (details below). |
| **D** macOS launch-repair DNS sweep | Codex #756 (+62/−10) | PR | Swift: **CI** macOS build, policy-tests and privileged-tests green | +XCTest via a small closure seam | Correct and minimal. Low risk. |
| D | GLM-5.3 | **No (strict).** Hunk counts wrong; applies with `--recount` | Swift can't build on Linux. Only `verify-swift-balance.py` OK. **Unverified** | none (argued there's no seam) | Same one-condition fix as Codex, correct by inspection. The change is trivial, so compile risk is low. |
| **E** Win WeChat signed-path reconnect | Codex #757 (+23/−8) | PR | Tauri crate `cargo check --tests` OK (on Linux, after installing GTK/WebKit dev libs and stub sidecars); `connection::` tests **115/115** | none (called a const test tautological); ci-gate green | Correct: `handle_network_change_inner(..,false)`, `watching_wechat` removed. Risk (shared with GLM): a forced reconnect at most every 2 minutes if path discovery keeps disagreeing. |
| E | GLM-5.3 | **No.** 1 hallucinated context line (`async fn` for `fn`); applies after that one-word fix | Compiles; `connection::` **116/116** | +1 tautological const-fn test | Logic identical to Codex. Correct. |

Codex group C (#755, +307/−7, 2 test files) had no GLM counterpart (out of scope). Its first push was green. Its later ci-gate "failures" are cancellations from main-merge updates.

Windows-native behaviour (WFP/BFE, registry) and Swift runtime were **not** verified. Only Linux unit tests with the fake engine, plus GitHub CI.

## 2. Codex polling

PRs #753–#757 were all opened at 14:37 (20:37Z), so polling stopped early. ci-gate went green on the first push for all 5. None of them are merged yet.

## 3. Cursor track record

Scope: 64 `cursor/*` PRs created Sep 30 (#695–#752, #764–#772). 62 have CI; #709 and #721 have none.

Method:
- I read check runs for every head, including heads replaced by force-pushes (GraphQL).
- Stacked-parent commits are attributed to the parent PR.
- Cancelled runs are ignored.
- 8 red runs are excluded as main-induced (`core` failures 17:18–17:51Z, from the #729×#732 digest break that #752 fixed).

| Metric | Value |
|---|---|
| First push green | **51/62 (82%)**; fix-titled 28/34 (82%); merged 25/28 (89%) |
| Red pushes (excl. main-induced) | 32 total. Concentrated in larger PRs: #724 (5), #715 (4), #707 (4), #746 (3), #718 (3), four PRs with 2 each, and five with 1 |
| Touches tests | 50/62; fix PRs 27/34 |
| Median size (fix PRs) | +/− 124 lines |
| Rework after merge | 29 merged. **#729 + #732** (each green alone) broke the mihomo YAML digest on main, and **#752** re-pinned it: 2/29 ≈ **7%**. No reverts found. |
| In-flight rework | #746 fixed #745's red e2e |

A later residual-gap PR (not a regression): #763 (`glm/`) fixes the emergency-disarm stale-core case that #711 left.

For comparison, from other processes' tracks (I didn't verify how they were produced): `glm/*` first push green 10/11 and `codex2/*` 10/11 (`data/table_*`).

## 4. Cost

| Tool | Cost per fix |
|---|---|
| **GLM-5.3** (8 CNY/M input, 2 CNY/M cached, 28 CNY/M output; ≈7.1 CNY/USD) | Paid calls with usage returned: E $0.22, D $0.11, B $0.35 plus a $0.32 truncated run, A $0.42 plus a $0.29 truncated run. **Known total $1.72.** |
| **Codex** | Token totals from the CLI: A 134k, B 140k, C 122k, D 80k, E 77k (effort max/xhigh). **$ unknown** (local CLI; no price available). |
| **Cursor** | **Unknown** (no billing access). |

GLM reliability problems:
- 4 GLM calls were lost to a box reset or to 40-minute stream stalls. If they were all billed, the worst case adds $2.70, for a total of at most $4.42.
- GLM spent 64k tokens on reasoning alone twice (finish=length). A and B only finished with trimmed context and max_tokens 110k.
- Each call takes 8–26 minutes.

## 5. Verdict

- **System-level Rust/Swift (A, B, D):** GLM's reasoning matched Codex's. It reached the same fixes and the same careful B2 "don't change" call, and its tests are real. But none of its 4 diffs was a strictly valid patch, and the context had to be curated by hand. Codex delivered green, mergeable PRs with repo-wide consistency, and it ran the tests itself. **Codex should own system-level fixes.** GLM is a cheap second opinion or cross-check.
- **Small or UI bugs:** all three can handle them. Cursor has the most throughput and 82–89% first-push green, but about 1 in 5 first pushes is red and cross-PR breakage happens (#752). Use it for volume behind the ci-gate, and give Codex anything that touches the WFP/PF/DNS barrier.
- **Caveats:**
  - The sample is 4 bugs.
  - The Codex PR changelogs say they were "reviewed and trimmed" by the orchestrator, so they aren't raw model output.
  - GLM was advantaged by my context curation, and disadvantaged by having no tool loop.
