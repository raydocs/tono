## 2026-10-27 · Does `windows-release` still wait for an environment reviewer?

- Status: owner
- Chosen: no. The GitHub environment `windows-release` keeps only its branch policy
  (`release/windows`), so `build-draft` in `windows-release.yml` starts as soon as `branch`,
  `pinned-core` and `sing-box-input` pass. Rejected: keeping the required-reviewer rule with the agent
  approving its own run.
- Why: owner, 2026-10-27 in chat: "为什么 winrelase gate 不能自动？ 让他自动开始" and "我已经 approve 了
  但我希望之后可以自动开始". On the 0.0.81 run
  [windows-release run 40445151033](https://github.com/raydocs/tono/actions/runs/40445151033)
  (candidate `dd38b3e9a`, release sequence 8101) the gate stalled the run for over an hour: the agent's
  self-approval under [decision 023](023-2026-09-28-agents-approve-gha-environments.md) was denied by the
  agent's own permission classifier, and the owner's first two approvals from the browser were not
  recorded; the third was. The reviewer was `raydocs`, the same account as the agents' token, so the rule
  was no human check. Unchanged: the signing secrets stay restricted to `release/windows` by the branch
  policy, and the customer channel still moves only through `windows-update-channel` at G4.
- Supersedes: the `windows-release` half of
  [decision 023](023-2026-09-28-agents-approve-gha-environments.md): there is nothing to approve or
  record for that environment any more. The `windows-update-channel` half is unchanged (reviewer
  `raydocs`, agents approve at G4 and record each approval).
- Applied in: `gh api -X PUT repos/raydocs/tono/environments/windows-release` on 2026-10-27
  (`reviewers: []`, `wait_timer: 0`, branch policy kept); `apps/windows/README.md`;
  [RELEASE_LINES](../RELEASE_LINES.md#customer-publish-g4); and
  `docs/changelog.d/2026-10-27-windows-release-env-no-reviewer.md`.
