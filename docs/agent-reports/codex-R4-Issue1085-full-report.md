# R4-Issue1085 delivery report

Baseline: `6ba79f61` from latest origin/main. Fix: `9957fe89`, branch `hunt/sol-r4i1085-ai-tally`, merged [PR #1160](https://github.com/raydocs/tono/pull/1160) at 2026-10-01 07:34:15Z with two-parent merge commit `2e9eb35dd6c85c13b1b818984ba678867a17bfb1`. Fix commit is an ancestor of current origin/main. Working tree clean.

The continuation assigns both tally rows here; the existing Codex claim on #1085 belongs to the same operator. No duplicate claim comment was posted. #1089 merged at 2026-10-01 07:22:08Z; #1160 therefore uses `Fixes #1085` and is the last PR covering the issue. No deployment/publication or other hunters' branch changes.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R3REGW-SELECTIVE-NETSH-PATH | Windows Service | P2 | apps/windows/service/src/core/selective_fail_open.rs:111 | Non-C system directory loses native AI IP hold | duplicate of #1089 |
| R3REGW-AI-TALLY-ACCOUNT-SCOPE | Windows tally | P2 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:48 | Replacement sign-in reads previous account local tally | real-fixed #1160 (ci-gate passed) |
| R3REGW-AI-TALLY-SEEN-GROWTH | Windows tally | P3 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:28 | Dedup receipts grow beyond bounded connection feed | real-fixed #1160 (ci-gate passed) |
| R4I1085-OTHER-SYSTEM-PATHS | Windows Service | — | apps/windows/service/src/core/update/security.rs:180 | Other tool paths fixed to C drive | false-positive: OS system-directory scheduler; other literals are tests |
| R4I1085-NETSH-LOCALE | Windows Service | — | apps/windows/service/src/core/selective_layer.rs:333 | Localized netsh text breaks reconciliation | false-positive: only exit status inspected |
| R4I1085-ADAPTER-NAMES | Windows Service | — | apps/windows/service/src/core/dns/engine.rs:1888 | Renamed adapters prevent selective hold | false-positive: prefix and namespace rules use no adapter names |
| R4I1085-SELECTIVE-RELEASE-DELAY | Windows Service | — | apps/windows/service/src/core/selective_layer.rs:60 | Native selective wait prolongs general network block | false-positive: broad release precedes bounded wait; native worker best-effort limitation |
| R4I1085-LATE-STORAGE-DIGEST | Windows tally | — | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:60 | Late email digest overwrites current account key | false-positive: effect cleanup cancels setter and keyed.email guard rejects stale key |
| R4I1085-STALE-TALLY-STATE | Windows tally | — | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:83 | Old tally state displays after current email changes | false-positive: render resets store and independently guards visible days |
| R4I1085-MISSING-AUTH-SCOPE | Windows tally | — | apps/windows/app/src-tauri/src/tono/route_preferences.rs:53 | No account lifetime scope available for cache isolation | false-positive: backend exposes opaque process and sign-in generation while ready |
| R4I1085-SELECTIVE-NRPT-POLICY | Windows Service | P2 | apps/windows/service/src/core/dns/engine.rs:1902 | Domain NRPT policy suppresses successful local AI suffix hold | real-unfixed: #1145; decision needed for enterprise NRPT enforcement |

11 hypotheses examined: 7 false positives, 1 duplicate, 2 verified findings fixed in merged #1160 (ci-gate passed), 1 real-unfixed decision issue #1145. The seven rejected hypotheses were retained from the previous run, not re-audited or re-reported as new.

## PR status

- #1160: non-draft; merge-commit auto-merge enabled; no labels. Exact rendered JSX matches baseline byte-for-byte, so the user’s pure data-scoping exception applies; neither ui-review nor needs-hardware is required. Hosted ci-gate run 36829922137 passed on exact source head 9957fe89; Windows frontend/core/app-rust/service jobs succeeded. Merged at 07:34:15Z as 2e9eb35d; #1085 closed at 07:34:16Z.
- #1089: other slot's PR, merged with ci-gate success; netsh duplicate only, untouched by this slot.

## Verification

- Node 24.21.0 / pnpm 11.26.0, frozen lockfile install with ignored scripts and existing writable cache; lockfile unchanged.
- Exact committed component/accumulator regressions against baseline production: `Tests 2 failed | 1 passed (3)`. A's Claude row remained while B's read was pending; 8,000 receipts retained. `tally-baseline-continuation.log`.
- Fixed component/tally plus Account/feed checks: `Tests 7 passed (7)`. `tally-fixed.log`.
- `pnpm typecheck`: passed; `unchecked indexed access errors 79 (baseline 79)`. `typecheck.log`.
- Targeted ESLint, new-test formatting, diff checks and record parser: passed. Initial test-only Node type errors corrected through Vitest's real WebCrypto loader without global Node types or tsconfig changes.
- Two independent read-only reviews: no blockers. Receipts refresh on zero-delta frames, eviction waits until the complete frame, empty remount snapshots preserve recent receipts, and generation reset remains unchanged.
- Windows native/Tauri/hardware not run on Linux; hosted ci-gate run 36829922137 passed; device acceptance remains unrun.

## Boundaries and remaining work

The feed exposes at most 2,000 active flows. A long-hidden flow can lose its finite receipt and later recount if it resurfaces; guarantees concern retained feed/recent receipts. Local tally is not billing/provider quota. No OOM or machine hang was demonstrated. No markup, copy, styling, storage format, privileged/network behavior or AI/strict blocking changes.

Requested static tally scope completed. Prior selective environment scan is retained. Native Windows/system-directory/netsh/NRPT/account-transition acceptance is unavailable on Linux. Enterprise NRPT suppression stays real-unfixed in #1145 pending an enforcement/product decision. Unrelated lifecycle/installer files were not exhaustively audited.
