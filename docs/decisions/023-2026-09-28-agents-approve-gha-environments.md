## 2026-09-28 · Who approves GitHub Actions environment approvals (e.g. `windows-release`)?

- Status: owner
- Chosen: agents approve them themselves with `gh` (`windows-release` for any candidate,
  `windows-update-channel` at G4) and record each one (run URL, environment, candidate SHA and
  release sequence) in `docs/changelog.d/`. Rejected: signed candidates outside the test kit
  waiting for the owner's approval.
- Why: owner, 2026-09-28 in chat: "之后都 ai 可以自行批准 不需要我批". Unchanged: customer
  channels move only after the owner's `[x]` for G1–G2 in SHIP_PLAN §6 (0.0.74), and only with
  the candidate that evidence names.
- Supersedes: "May the agent approve the `windows-release` environment for test-kit signing?"
  (2026-09-26), widened from the kit to every run, and RELEASE_LINES' "any other signed G3
  candidate waits for the owner's approval".
- Applied in: [RELEASE_LINES](../RELEASE_LINES.md#customer-publish-g4); first self-approval
  [windows-release run 36383440146](https://github.com/raydocs/tono/actions/runs/36383440146)
  (0.0.74 sequence 7422, `ccbc50a8`), recorded in `docs/changelog.d/2026-09-28-regression-a1d498c8-minors.md`.
