# CI runner queue (2026-10-13)

Checked origin/main `86fe66dca` and open PRs before editing. Nothing else was removing the duplicate macOS runs, adding Cargo `restore-keys`, or sharding the nightly. #1649 (already merged) is a read-only audit with a different list (fold macOS jobs, `Swatinem/rust-cache`, nextest). These PRs do the three items below and leave that list alone.

## What the runs actually did

macOS wall clock is mostly waiting for `macos-26`, not compiling.

| Run | What | Wall | Job time | Queue |
|---|---|---|---|---|
| [38359906046](https://github.com/raydocs/tono/actions/runs/38359906046) | macos-ci push main `3a0f8e5cd` | 47.3 min | build 6.6, unit-tests 7.9, policy 4.2, privileged 1.8 | unit-tests 39.4 min after the run started (sing-box finished at 6.2) |
| [38456735412](https://github.com/raydocs/tono/actions/runs/38456735412) | macos-ci push main `ba5a8a9f4` | 10.3 min | unit-tests 8.2 | about 2 min |
| [38456848261](https://github.com/raydocs/tono/actions/runs/38456848261) | macos-ci push release/macos `86fe66dca` | 13.2 min | same four jobs | about 4–8 min, one minute after the main run |

`release/macos` was fast-forwarded 815 commits (`e99678129..86fe66dca`) onto the same tip as main. The path filter sees every macOS file in that range, so the suite runs again for a tree main already tested commit by commit. The two runs together held eight `macos-26` runners.

`macos-release` and `macos-dmg` are `workflow_dispatch` only. Today's release [38456814050](https://github.com/raydocs/tono/actions/runs/38456814050) and dmg [38460255124](https://github.com/raydocs/tono/actions/runs/38460255124) are the publish path, not a second copy of macos-ci. `zz-core-check.yml` is not on main. It ran on `claude/toolchain-go-core-check` (38365065807 failed, 38366708463 and 38376168845 succeeded, last finished 10:19 UTC). Left that branch alone.

Windows Cargo cache is exact-key only. On main [38384927839](https://github.com/raydocs/tono/actions/runs/38384927839) `app-rust` was an exact hit: job 9.6 min, restore 73 s, Tauri tests 376 s, save skipped. A lockfile change misses and rebuilds `target/`.

Screenshots nightly [38339472847](https://github.com/raydocs/tono/actions/runs/38339472847) wall 18.0 min. The long step is ops-console `npx playwright test` at 1017 s, not the Mac window captures (English 277 s, Chinese 80 s, job 8.2 min). The failing schedule [38329115816](https://github.com/raydocs/tono/actions/runs/38329115816) spent 935 s in the same step.

## Changes

| PR | Change | Left in place |
|---|---|---|
| #1655 | Release-branch push whose SHA is already on main does not queue the four `macos-26` jobs. A commit that is not on main still runs. ci-gate is unchanged. | Did not fold build + unit-tests. Unqueued critical path is unit-tests at ~8 min; serializing the 6 min Release build makes the quiet case slower. Did not fold policy-tests into privileged-tests; privileged mutates the host. |
| #1657 | `core`, `app-rust`, `service` restore a same-runner, same-rustc prefix when the lockfile key misses. Exact hit still reports hit. Save stays main-push and exact-key only. | No cross-rustc fallback. This PR's lockfile matches main's saved key, so its own run should still be an exact hit. |
| #1656 | Nightly pixel compare uses the PR gate's four shards, on `macos-26`, without `--ignore-snapshots`. Re-record stays one job. | Window-capture xcodebuild stays two serial steps. Nightly compare goes from 1 macOS runner to 4, at 18:23 UTC. |

Required check name stays `ci-gate`. Job names inside macos-ci are unchanged.

Windows and services still re-run on a release-branch fast-forward ([windows-ci 38456848265](https://github.com/raydocs/tono/actions/runs/38456848265) started with the macOS duplicate). Not in these PRs; Windows runners were not the queue.

## After

Filled in when each PR's ci-gate (and a nightly dispatch for #1656) has a number. Not claimed before that.
