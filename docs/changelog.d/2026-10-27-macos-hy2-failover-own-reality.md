## 2026-10-27 · macOS hy2 失败先回同节点 Reality 块
- 归属：G2（连不上有下一手）；macOS `Core/ExitHeal.swift`。
- 来源：基线 origin/main `6b76cfa46`；分支 `fix/macos-hy2-failover-own-reality`。
- 缺陷修复：MAC-HY2-FAILOVER-SKIPS-OWN-REALITY。当前拨号为 hy2 且失败类别非 QUIC/auth 时，同节点 Reality 块按换传输（rank 0）排第一，与 Windows 一致。
- 新增/优化：无。
- 工程与测试：`ExitHealTests.testATimedOutHy2DialGoesToTheSameNodesRealityBlock`（Windows 对应 `a_hy2_dial_that_timed_out_goes_to_the_same_nodes_reality_block`）。
- 验证：见 PR 验证评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机。
