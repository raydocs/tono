# Claude Code issue-fix batch: R4 FixMisc + FixNew (2026-10-01)

Scope: the two Codex R4 slots handed to Claude Code (`codex-r4-prompt-FixMisc.md`, `codex-r4-prompt-FixNew.md`), run from
origin/main `0676435b`. FixMisc: #1134, #1125, #1131, #1132. FixNew: every open issue created after 2026-10-01T06:00Z that
nobody had claimed. Each issue was claimed with "Taking this (Claude Code)" and re-verified on current main before any fix.

Rules applied: one PR per fix (or per tightly coupled pair), `Fixes #N`, one regression test, auto-merge with a merge commit,
and `needs-hardware` on anything that touches networking, PF/WFP, DNS, the helper or the connection lifecycle. Swift and Windows
Rust tests were not run on this Mac (owner rule); hosted CI runs them. No jev-route or Codex review was run (owner brief:
not required for this batch).

Severity is our own calibration (P0 = plausible single-failure path to network loss, crash, broken sign-in, billing
corruption or data exposure; P2 at most = two independent failures, admin misconfiguration or a millisecond race).

## Per-issue verdicts

| Issue | Area | Verdict | Severity | PR | Labels |
|---|---|---|---|---|---|
| #1131 | macOS PF interface scope / LAN DNS | already fixed by #1135 (closed 07:56Z) | — | #1135 (merged) | — |
| #1134 | Windows late StartClash after timeout | real; late compensation of a timed-out generation now uses the AI-preserving release; explicit causes keep plain release | P2 | #1216 | needs-hardware |
| #1125 | Windows account switch | real; live connect error/stage/steps cleared on adoption and account close, kept on same-account Disconnect | P2 | #1211 | — |
| #1132 | macOS pending-update release join | real after #1099; an explicit Restore that joins an automatic update release is remembered and one plain release follows | P2 | #1220 | needs-hardware |
| #1151 | macOS Restore during update Commit | real; on "No pending update owns Disconnect" the app re-reads authenticated `/update/status`; only `pending=false` clears gates and runs ordinary teardown | P2 | #1220 | needs-hardware |
| #1117 | macOS signed-out cold launch | real; when the helper confirms no broad block is held, launch restores DNS only and keeps the AI hold; any other case keeps the full release (never leaves the network blocked) | P2 | #1226 | needs-hardware |
| #1174 | macOS disconnect telemetry | real; separate live-session start, consumed once at teardown | P3 | #1223 | — |
| #1165 | macOS helper removal after DNS restore failure | real; PF still opens, but removal/emergency-reset keep the helper installed so DNS recovery retries | P2 | #1222 (helper 4.52.29) | needs-hardware |
| #1169 | macOS interrupted explicit Restore | real; explicit Restore writes a `releasing` marker, startup/watchdog/failed-startup finish a pending removal once; completed `released` is a no-op | P2 | #1222 | needs-hardware |
| #1164 | macOS selective route ownership | real but not fixed: needs route readback/ownership capture and restore of displaced admin routes, qualified on hardware; design posted on the issue | P2 | — (open) | — |
| #1181 | control-plane ops quota | real; cycle update is now compare-and-set on the values read, counters read after the cycle row; a losing stale reading is dropped (next cumulative reading counts it) | P2 | #1218 | — |
| #1200 | ops-console UTC bucket labels | real; Errors and home-line usage tooltips use `formatUtcDate` | P3 | #1212 (merged) | — |
| #1137 | Windows tray stale rates | real; tray shows /s rates only while the traffic feed is live | P3 | #1213 | — |
| #1152 | helper contract guard | real; build rejects a matching hash with a different recorded version; fresh-version/stale-hash still builds; guard test wired into macos-ci policy-tests | P2 | #1217 | — |
| #1192 | macOS log upload before window confirm | real; only an empty probe is sent until the server stores one (Windows #1193 design, #1193 untouched) | P2 | #1214 | — |
| #1201 | telemetry free text identifiers | real; server redacts event free text before storing/flattening (#1224, `Fixes`); Windows client scrubs with the support-report scrubber (#1225, `Refs`). macOS client unchanged (no scrubber to reuse) | P3 (opt-in) | #1224, #1225 | — |

Unfixed P0/P1 in this batch: none. All verified issues calibrated P2 or P3.

## Not taken (reported, not decided)

- Owner decisions, untouched: #1120, #1145, #1052, #1051, #1139 (P1 title; decision item per handoff), #1071, #901, #829,
  #1056/#1057 decision lines, #724, #725.
- #1197 and #1204 (Windows core selection / DIRECT admission): the Windows sing-box path is owned by the main Claude Code
  session alongside open PR #1188; left to that owner.

## Open risks

- Helper version: #1222 takes 4.52.29; open PR #795 also claims 4.52.29. Whichever merges second must rebase and re-bump.
  With #1217 merged, a version/record mismatch fails the build instead of slipping through.
- #1222: if DNS restore keeps failing while the app is absent, the helper stays installed with PF open and re-runs emergency
  release every 10 s.
- #1226: a signed-out user keeps the AI hold until sign-in plus Restore. This matches the issue's intent; flag for the owner
  if signed-out behavior should differ (adjacent to #1052).
- #1218 changes a concurrent D1 write (compare-and-set); no migration. Takes effect only after a control-plane deploy, as does #1224.
- #1214 vs #1193: both add `docs/findings.d/MAC-LOG-UPLOAD-PROBE-LINES.md`; the second to merge resolves an add/add conflict.
- #1211 and #1216 both edit `apps/windows/app/src-tauri/src/tono/state.rs` in separate hunks.
- No new regression test was seen failing on old code for the Swift/Windows-Rust PRs (not runnable here); locally run tests:
  #1200 Errors test, #1137, #1152 and #1224 failed before and pass after; #1181 timed out on old code and fails on
  assertion with its guard removed; the #1200 home-line test was not run on old code.
- Hardware items for the final #1053 checklist: #1216, #1220, #1222, #1226 (timeout/late-commit ordering, update Commit vs
  Restore, removal with locked SCPreferences, interrupted Restore, revoked-session force-quit relaunch).
