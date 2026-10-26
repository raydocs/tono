## 2026-10-26 · Independent review before merge and deploy is paused
- Status: owner
- Chosen: no Codex, Grok, Claude or other second-model review is required before merge or deploy, including
  high-risk changes, until the owner lifts this; a review runs only when the owner asks for one on a specific
  PR. Rejected: keeping the required Codex review for high-risk diffs, which had left PRs (for example #1735)
  waiting with no review provider available.
- Why stricter: it is not stricter; it is the owner's own call, given in chat on 2026-10-26 ("review 就先不用
  review"). ci-gate, the narrow regression test, the verification comment, the UI and real-hardware
  auto-merge exclusions and every release gate still apply. High-risk PRs name the risk and the invariant
  they keep in the PR body.
- Applied in: `AGENTS.md` (Finish the work §1, Review policy).
