## 2026-10-06 · Is the sea appearance part of 0.0.75, and is it on by default?

- Status: provisional (owner in chat, 2026-10-06, in two messages to the Claude session: "我希望 0.0.75 版本是一个全面大升级
  稳定性流畅性和美学" and, answering the agent's two questions about merging the UI and its default, "授权你合并 新外观开";
  the owner can set `owner` here)
- Chosen: yes to both. The Windows stack (#1375, #1393, #1406–#1414 and this PR) and the macOS PR #1405 merge into
  `main` for 0.0.75, and a device with no stored choice starts in the new appearance. An explicit "off" in
  Settings → Appearance is kept and returns the previous look. Rejected: default off with a switch (the agent's
  recommendation; the owner chose on) and shipping the look in a later version (decision 061's "Not included").
- What this changes in earlier decisions, without editing them: decision 061's exclusion of the Windows UI from 0.0.75,
  and the "default-off" clauses of 055/069 (Windows; 069 was numbered 063 before it reached main) and 064 (macOS). AGENTS forbids agents to auto-merge UI PRs; the
  owner's "授权你合并" is the owner merging through the agent for these PRs only, not a change to that rule.
- What it does not change: every merge condition in AGENTS (exact-head ci-gate, review depth per PR, no open review
  thread, base-first order, combined regression review of the batch). The gates: the frozen source `e28ca45c` and its
  signed candidates (sequence 7501) no longer describe 0.0.75; a new freeze and new candidates are needed, and the
  owner's G1/G2 acceptance in SHIP_PLAN §6 must name the new candidate. G3 stays in 0.0.76. No customer feed moves here.
- Why stricter where the owner left room: the switch stays, so one tap restores the look every earlier build shipped;
  protection, connection, routing and privileged semantics are untouched; nothing is published on this decision alone.
- Not verified: no Windows / WebView2 or macOS real-window run of the new look by the owner yet; scene cost on weak
  hardware is unmeasured (the automatic quality step-down is the only guard).
- Applied in: this PR (Windows default and wording). The macOS default belongs to #1405's owner (Codex session).
