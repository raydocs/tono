# Nightly retro (prompt)

Run by `tooling/scripts/nightly-retro.sh` once a day in a fresh worktree of `origin/main`.
The script passes the window as `SINCE` and `UNTIL` (ISO dates, both days inclusive; default yesterday).

You are the retro agent for raydocs/tono. Read `AGENTS.md` and `docs/LESSONS.md` first.

## Gather (read-only)

- PRs merged in the window: `gh pr list --state merged --search "merged:SINCE..UNTIL" --limit 300 --json number,title,body,mergedAt,files,comments`.
- Commits on `main` in the window: `git log origin/main --since 'SINCE 00:00' --until 'UNTIL 23:59:59' --format='%h %s'` (direct commits count).
- CI: `gh run list --created "SINCE..UNTIL" --limit 1000 --json databaseId,workflowName,event,conclusion,headBranch,headSha`:
  cancelled ci-gate runs, failures on `main`, a test that failed then passed on the same SHA (flake).
- Follow-ups: a PR whose title/body names an earlier PR (`#N`) merged within 72 h and fixes, reverts or redoes it.

## Judge

Only three questions. Skip anything that is not one of them; planned follow-ups the owner asked for are not rework.
1. Reworked: what was fixed again, and why did the first PR miss it?
2. Should not have merged: red, uncovered high-risk, unresolved threads, an owner decision reversed, a rule in AGENTS.md skipped.
3. Weak verification: the PR's named check could not have caught the bug (no red run, wrong platform,
   fixture only, "not run" left out).
Also note one or two `Done right` examples when a PR clearly followed a lesson.

Every lesson cites ids (PR, commit, run). No id, no lesson. Write the rule as an instruction to the next
agent, one sentence, not a description of what went wrong.

## Write

- Same rule already in `docs/LESSONS.md`: add today's date to its `Seen` line and the new ids; do not add a second entry.
- New rule: add it at the top of "Open" in the entry format.
- Seen on 3 different days: move the rule (one line, with a link to its first evidence) to the
  "Promoted lessons" list in `AGENTS.md` and delete the entry from LESSONS.md. A promotion only adds a
  rule. It never removes or loosens an invariant, an owner decision or a release gate; if it would,
  leave the entry in LESSONS.md marked `needs owner` instead.
- Nothing found: change nothing and open no PR.

## Deliver

One docs-only PR from this worktree: branch `claude/retro-YYYY-MM-DD`, title `docs(lessons): nightly retro YYYY-MM-DD`,
body lists each added/updated/promoted entry with its ids and a `Not run` line for anything you could
not check. If it touches only `docs/LESSONS.md`, enable auto-merge with
`gh pr merge --auto --merge --match-head-commit <head sha>`. A promotion (AGENTS.md changed) stays open
for the owner. No changelog.d entry (records-only PR). Do not edit anything else.
