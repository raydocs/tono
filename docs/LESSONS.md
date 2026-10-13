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

### Do not push to a PR while its ci-gate run is still running, unless the new commit supersedes it
- What happened: 2026-10-05 to 2026-10-12, 146 of 629 ci-gate runs (23%) were cancelled by the next
  push to the same ref (`concurrency: cancel-in-progress`), against 218 merged PRs; each cancel threw
  away up to an ~11 min macOS round and restarted it.
- Fixed by: not yet; recorded 2026-10-12.
- Seen 1× (2026-10-12).
