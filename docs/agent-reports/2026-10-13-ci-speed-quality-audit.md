# CI speed and quality audit (2026-10-13)

Read-only audit of raydocs/tono settings and workflows. No settings were changed. Data: last 300 workflow runs
(2026-10-12 17:14 to 2026-10-13 06:08 MT) and job timings from the last 40 completed ci-gate runs.

## Measured baseline
| Item | n | Median | p90 / max |
|---|---|---|---|
| ci-gate wall clock, pull_request | 143 | 11.2 min | p90 41.0 |
| ci-gate wall clock, workflow_dispatch (agent red runs) | 86 | 38.5 min | p90 73.3 |
| windows / app-rust (windows-2025) | 38 | 8.2 min | max 13.8 |
| macos / unit-tests (macos-26) | 32 | 7.6 min run + **9.0 min queued** | max 29.4 |
| macos / build (macos-26) | 32 | 5.9 min run + **11.2 min queued** | max 29.4 |
| windows / service (windows-2025) | 38 | 5.3 min | max 22.9 |
| services / ops-console-e2e (4 shards) | 29 | 4.3 to 4.6 min | 5.2 |
| macos / policy-tests, privileged-tests | 32 | 3.9 / 2.4 min, queued 8.7 / 4.5 | 29.4 |

Step breakdown of one green run: app-rust "Test the Tauri crate" 5.4 min, "Restore Cargo cache" 52 s;
service "Test the service lifecycle" 2.7 min, "Build the service the way the release does" 1.2 min.

Settings: ruleset "main: PR + required ci-gate" requires only `ci-gate` (strict off), merge method merge only;
**no merge_queue rule is active** although ci-gate listens to `merge_group`. Auto-merge allowed. Actions cache
**10.7 GB in 15 entries, above the 10 GB limit**, so entries are being evicted.

## Recommendations (priority order)
1. **Cut macOS runner queueing (biggest lever, ~9 to 11 min per macOS PR).** Each macOS-touching run starts
   4 `macos-26` jobs (build, unit-tests, policy-tests, privileged-tests) that each compile from source; the account's
   concurrent macOS runner limit makes them queue, and parallel agent PRs plus red-run dispatches compound it.
   Change: merge build + unit-tests + policy-tests into one macOS job that builds once (`xcodebuild build-for-testing`
   then `test-without-building` per plan), keep privileged-tests separate only if it needs a clean host. Expected:
   1 to 2 macOS slots per run instead of 4, queue median toward 0 to 3 min, macOS minutes down ~40%. Risk: medium
   (one job failure masks others; keep `-only-testing` groups as separate steps with `if: always()`).
2. **Stop the cache eviction thrash.** 10.7 GB > 10 GB. Change: save caches only from main (already done for Cargo
   registry) and add a weekly prune of non-main cache keys; key per job so windows-2025 and ubuntu do not overwrite.
   Expected: restores keep hitting; prerequisite for item 3. Risk: low.
3. **Cache Rust build output on windows-2025.** Today only `~/.cargo/registry` is cached; app-rust and service
   compile all crates every run. Change: `Swatinem/rust-cache` (pinned SHA, `save-if: github.ref == 'refs/heads/main'`)
   or sccache with GHA backend for app-rust and service. Expected: app-rust 8.2 to ~4.5 min, service 5.3 to ~3.5 min.
   Risk: low; rust-cache keys on Cargo.lock and toolchain.
4. **Use cargo-nextest for the Tauri crate and service tests.** "Test the Tauri crate" is 5.4 min single-binary
   serial output. Change: `cargo nextest run --locked` (install via taiki-e/install-action pinned) and, if needed,
   `--partition count:N/2` across 2 windows jobs. Expected: 1.5 to 3 min off app-rust. Risk: low to medium (tests
   that share global state need `test-group` serialization in `.config/nextest.toml`; service lifecycle/DNS tests
   likely do).
5. **Throttle agent `workflow_dispatch` red runs.** 86 dispatch runs in ~13 h, median 38.5 min, mostly
   `claude/*-red*` branches; they consume the same macOS/Windows slots as real PRs. Change: in ci-gate add
   `concurrency.group: ci-gate-${{ github.event_name }}-${{ github.ref }}` (already cancel-in-progress) and document
   in AGENTS.md that red runs should use the platform workflow (windows-ci.yml / macos-ci.yml dispatch) instead of the
   whole gate. Expected: frees macOS queue for PRs. Risk: low.
6. **Either enable the merge queue or drop the `merge_group` trigger.** The ruleset has no merge_queue rule, so
   `merge_group` never fires and PRs merge on a possibly stale base (strict checks off). Change (owner decision):
   add a merge_queue rule (merge method MERGE, grouping ALLGREEN, max group size 3, min 1, wait 5 min,
   check timeout 60 min). Quality: tests every merge against current main. Speed: batching amortizes macOS runs.
   Risk: medium; queue runs use full ci-gate, so do items 1 to 3 first.
7. **Close the release-workflow gap from docs/LESSONS.md.** ci-gate never runs macos-release.yml or
   windows-release.yml, so new build inputs break candidates (seen again with the candidate A retarget today).
   Change: add a `release-dry-run` job to ci-gate, path-filtered to `.github/workflows/*release*.yml`,
   `apps/*/` build config, toolchain pins, that runs the release build steps with signing disabled
   (`candidate_only`, no notarize, no upload); plus an `actionlint` job on any workflow change. Expected cost
   ~8 min macOS only on PRs touching those paths. Risk: low; big quality win.
8. **Small items.** `changes` job uses `fetch-depth: 0` (max 3.6 min); use `fetch-depth: 0` only on merge_group or
   fetch base SHA with depth 1 (saves ~0.3 to 3 min). Add `timeout-minutes` on every macOS/Windows job (macOS jobs
   hit 29.4 min max). Docs-only PRs already skip heavy jobs via `ci-gate-changes.mjs` (verified: changes + ci-gate only).

## Expected total
For a PR touching macOS + Windows: today median ~11 min run plus ~10 min macOS queue at busy times; after 1 to 4,
~6 to 8 min with little queueing. Agent red-run load (item 5) is the main source of the 41 min p90.

## Not done
No settings or workflow changes; items 1 to 7 need owner approval and separate PRs (avoid #1605 and the candidate A
workflow PR, which touch macos-release.yml).

_Generated by Grok Bot._
