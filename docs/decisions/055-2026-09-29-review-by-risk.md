## 2026-09-29 · Does every PR need a routed jev-route review, and every merged batch a combined regression review?

- Status: provisional
- Chosen: no. Review follows risk. Ordinary work (copy, docs, UI, a normal bug or feature) is checked by the
  main session with the narrowest relevant test. High-risk changes (money, credentials/permissions, PF/WFP
  fail-closed behavior, privileged paths, concurrency/lifecycle, migrations, routing, release trust) and
  owner-requested reviews need an independent Codex high review of the current diff, finished and recorded in
  a PR comment before merge or deploy; pending, timed-out, incomplete or stale coverage is not a pass. A merged
  batch reuses the review coverage of exact PR heads; only uncovered high-risk commits and integration changes
  are reviewed before a deploy. jev-route stays available but is not a per-PR gate. Rejected: keeping the
  mandatory routed review per PR and the whole-batch regression review of
  [008](008-2026-09-24-merge-without-asking.md), which this supersedes on those two points; 008's other
  conditions (exact-head CI, no unresolved threads, merge order, no per-PR owner approval) stand.
- Why stricter: nothing in the high-risk categories loses its review, and uncovered high-risk commits still
  cannot be deployed. The cost is that ordinary changes are no longer seen by a second model.
- Applied in: [AGENTS.md](../../AGENTS.md) "Finish the work" item 1 and
  [BUILD_AND_TEST.md](../BUILD_AND_TEST.md#which-workflow-must-be-green-for-a-pr), #1385. The text is the
  owner's own edit of 2026-09-29, committed on the owner's instruction of 2026-10-05; the status is left
  `provisional` because only the owner sets `owner`.
