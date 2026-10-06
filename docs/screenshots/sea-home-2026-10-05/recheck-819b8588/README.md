# PR2 re-check of819b8588 — 2026-10-05

Draft[#1393](https://github.com/raydocs/tono/pull/1393), stacked on draft#1375.
Owner PR2-REVIEW R1–R4 continuation. MacBook M3 Pro/macOS26.5.2,
headless Chrome154.0.8037.93. Actual home components with synthetic native IO;
not a real VPN transaction or Windows qualification. [Source fingerprints](source-fingerprints.json)
tie the uncommitted audit inputs to the source delivered in this same commit.
[Earlier H1–H12/S2 evidence](../review-corrections/README.md) is retained, not rewritten.

## R1 / R2, what changed

- R1: downward whenever below≥200px; flip upward only below<200px and above>below.
  List remains320px wide and scrolls inside the available room. At920×600,
  below255.1px/panel y336.9..546.9; at860×540, below208.3px/panel y323.7..532.0.
  The title remains uncovered. [Default](picker-down-920.png),
  [minimum](picker-down-860.png), [exact geometry](picker-geometry.json).
- R2: secondary backup/copy/upload/DNS text buttons are behind the card's
  default-closed Technical details disclosure. No third action row; original
  handlers/disabled rules unchanged. Retry/restore/line choice are still only
  under the title. This explicitly supersedes the earlier H3 external-toolbar
  rule **for secondary tools only**, not duplicate primary actions.
  [Failed closed](collapsed-failed-920.png), [offline closed](collapsed-protectedOffline-860.png),
  [disclosed text tools](technical-tools-failed-920.png),
  [long English minimum](technical-tools-protectedOffline-long-en-860.png).

[13 placement/visibility/material/Escape checks](layout-checks.json) pass,
including the genuine short-space upward fallback. [8 long-English minimum and
native Enter/Tab checks](tools-keyboard.json) pass,0runtime exceptions.
Hidden disclosure controls do not paint or receive keyboard focus; disclosed
controls are reachable and have no blur/shadow/chip fill. Cards retain an internal
scroll area. Clicking/opening does not run backup/upload automatically.

## R3 — explicitly deferred, not closed

The sheet scroll area works; legacy card layout/cosmetic cutoff at its edge is
carried to ROUND-3 PR4 foundation. No further card restyling in PR2. This
supersedes the earlier receipt's broader H12 cosmetic acceptance claim.
[IHOME-12](../../../findings.d/IHOME-12.md) stays open; it is not a PR2 blocker.

## R4 — same-preview numeric comparison before PR3

Optional `&diagnostics` displays the existing bounded scene probe. `Measure 3 s`
explicitly re-arms its saved revision; **no second/continuous animation loop**.
It is a development entry only, absent from the production bundle.

[Raw reports/readout text/state/revisions](pacing-matrix.json),
[terminal output](pacing-matrix.txt), [script](pacing-matrix.mjs).
Same owned Chrome page, manual Full/Lite, connected steady state. No tracing or
screencast during sampling; screenshots occur only after each probe completes.
Every report is fresh (new revision),3s of visible frames,180–181samples. No
concurrent source tests/builds. Default home has a200px sidebar (scene720×600);
fullbleed home and scene-only preview have matched920×600 scenes. The standalone
scene preview includes its existing demo text/dock/readout and uses the S2 bundle
with identical scene code/CSS; it is not an empty renderer benchmark.

| Case | rAF fps | p95 ms |
|---|---:|---:|
| scene-full | 60.0 | 16.7 |
| home-default-full-closed | 60.0 | 16.7 |
| home-default-full-open | 60.0 | 16.7 |
| home-default-full-closed-repeat | 60.0 | 16.7 |
| home-fullbleed-full-closed | 60.0 | 16.8 |
| home-fullbleed-full-open | 60.0 | 16.8 |
| scene-lite | 60.0 | 16.7 |
| home-default-lite-closed | 60.0 | 16.8 |
| home-default-lite-open | 60.0 | 16.7 |
| home-default-lite-closed-repeat | 60.0 | 16.7 |
| home-fullbleed-lite-closed | 60.0 | 16.7 |
| home-fullbleed-lite-open | 60.0 | 16.7 |
| blank control | 60.0 | 16.8 |

Renderer: ANGLE Metal / Apple M3 Pro.0runtime exceptions across the matrix.
[Full closed](pacing-home-default-full-closed.png)/[open](pacing-home-default-full-open.png),
[Lite closed](pacing-home-default-lite-closed.png)/[open](pacing-home-default-lite-open.png),
[Full scene](pacing-scene-full.png)/[Lite scene](pacing-scene-lite.png).

**No sheet-specific or home-specific halving reproduced:** all fresh readouts
round to60.0fps, p95≤16.8ms. The previous~30fps traces and blank control remain in
the historical receipt; their cause is **not identified**, and these numbers do
not prove zero sheet cost or GPU presentation FPS. This is a bounded rAF pacing
proxy, not Windows/WebView2/weak-GPU/RDP qualification or an all-state stress test.
No speculative scene/animation changes were made for this comparison.

## Source checks / honest controls

- The revised R2 and new R1 regressions [actually fail on819b8588](controls/before-tests.txt):
  `Tests2failed|17passed(19)`. No test-only app logic or changed old-page tests.
- [Current narrow checks](narrow-tests.txt): `Test Files2passed(2),Tests53passed(53)`
  (home19 + unchanged ConnectProgress34). No full-suite rerun for this bounded
  home-only continuation; historical full run351tests/49files remains historical.
- [Typecheck](typecheck.txt): unchecked-index79/baseline79;
  [scoped ESLint](eslint.txt): exit0,5TSfiles;
  [Biome](biome.txt):6files/no fixes;
  [frontend build](build.txt): built in1.23s. No native build/package.
- [Baseline/source invariants](source-fingerprints.json): original dashboard/
  progress/Lines tests, old locale values, main home/scene/quality code and fixtures
  unchanged from819b8588. Production diagnostic string matches0.
- The first layout instrument incorrectly assumed closed native `<details>`
  descendants have no rects; Chrome keeps layout rects but `checkVisibility()`
  is false. Corrected the instrument, not the app. A real specificity defect
  initially left blur/highlight on disclosed tools; the home-only selector now
  wins. [Original8failures](controls/first-layout-control-layout-checks.json) retained.
- The first pacing selector treated the always-mounted, inert closed sheet as open;
  it now reads `data-open`. [Failed control](controls/pacing-control-mounted-sheet-selector.txt).
  First keyboard injection lacked Enter's native character event; added CDP
  `text:'\r'` (verified keydown/keypress/click/keyup), not a synthetic JS click.
  [Original keyboard control](controls/keyboard-control-tools-keyboard.json) retained.
- A shell footer attempted the read-only zsh variable `status` after checks/build
  had completed; source logs were read and lint explicitly rerun with an exit
  receipt. Not counted as a successful orchestration command.

Only empty EOF lines in copied terminal logs were normalized for git diff checks;
original logs remain in `/tmp/tono-pr2-recheck-20261005/`. No substantive log edits.
Source fingerprints/local links/diff check are checked before delivery. No
merge/auto-merge/external reviewer/native build/deployment/publication. PR3 source
has not started in this correction. Windows5-minute quality/native acceptance
remains with the owner. CI is recorded in the PR on the exact pushed head, not
inferred from local checks or the older green819b8588 run.

Audit scripts retain the capture-time `/tmp` output/bundle paths and owned CDP9384;
set up those inputs or adjust paths when replaying. Start only your own browser
profile; never connect to another user's browser/Vite session. The normal
production build has no preview fixtures or probe readout UI.
