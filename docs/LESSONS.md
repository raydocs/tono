# Lessons

Mistakes agents made on this repo, written by the nightly retro
([prompt](ops/nightly-retro.md), `tooling/scripts/nightly-retro.sh`). Read this before a fix, a
review or a merge. A lesson seen on 3 different days moves into [AGENTS.md](../AGENTS.md)
("Promoted lessons") and is deleted here; it is then checked on every PR.

The retro looks only for three things in the day's merged PRs, main commits and CI runs:
1. Reworked: a later PR fixed, reverted or redid something merged shortly before.
2. Should not have merged: merged against a rule in AGENTS.md, red or uncovered, or reversed an owner decision.
3. Weak verification: the check named in the PR could not have caught the bug it claims to fix.

Entry format (newest first, one rule per entry; `Done right` entries say what to keep doing):

```
### <one-sentence rule>
- What happened: <PR/commit/run ids, and the cost: rounds, hours, a customer>
- Fixed by: <PR/commit>
- Done right: <an example that followed the rule> (optional)
- Seen N× (YYYY-MM-DD, YYYY-MM-DD).
```

## Open

### When a PR adds something the test or build step needs (env flag, helper flag, bundler or toolchain pin), make the same change in the release workflows in that PR, because ci-gate never runs `macos-release.yml` or Windows packaging
- What happened: three candidate builds died on inputs ci-gate had passed. #1426 added render tests that
  need `TONO_HOSTED_WINDOW_DIAGNOSTIC`; macOS 7502 run 37651992656 failed 14 tests (2026-10-07). #1421 moved
  `@tauri-apps/cli` 2.11.5 → 2.12.1 without re-diffing the forked `installer.nsi`; Windows 7502 run
  37651997330 failed in makensis (2026-10-07). #1444 added a helper self-test flag; macOS 7504 run
  37714743032 ran XCTest against the stale committed `tono-core-helper` (2026-10-08). Cost: candidates 7502
  and 7504 void, two extra rebuild rounds (7503, 7505).
- Fixed by: #1431 (release XCTest env), #1433 (NSIS template sync guard), #1453 (build the helper before
  XCTest, order assertion); the two hand-written copies of the pre-test steps are still open.
- Seen 1× (2026-10-12).

### Make a new timing-sensitive test deterministic (injected clock, timer or mtime, no wall-clock race) before merge; one green ci-gate run does not prove it
- What happened: #1426's `SeaScenePaletteTests.testBackingScaleChangeRebakesContentsAtUnchangedPointSize`
  passed on ci-gate 37599813927, then failed on the `main` push run 37601838043 and on dispatched ci-gate
  37656500526 and 37692420659 while the `pull_request` runs on the same SHAs passed (2026-10-07). #1476's
  worktree idle test raced `Date.now()` against sub-ms index mtimes and failed ci-gate 38066396683
  (2026-10-10). Also flaky this window: ops-console `ledger.spec.ts:155` (ci-gate 38056004583, fixed by
  #1537) and control-plane `rotates failed revocations…` at 5.6 s (ci-gate 38038250312, not fixed).
- Fixed by: #1440 (e6a145ee7, 957d53b9e), #1535, #1537.
- Done right: #1535 injected the mtime and ran the test 50× with no sleeps or retries; #1440 fixed the
  density invalidation instead of raising a timeout; #1517 tested the 900 s budget with a fake clock.
- Seen 1× (2026-10-12).

### Do not push to a PR while its ci-gate run is still running, unless the new commit supersedes it
- What happened: 2026-10-05 to 2026-10-12, 146 of 629 ci-gate runs (23%) were cancelled by the next
  push to the same ref (`concurrency: cancel-in-progress`), against 218 merged PRs; each cancel threw
  away up to an ~11 min macOS round and restarted it.
- Fixed by: not yet; recorded 2026-10-12.
- Seen 1× (2026-10-12).
