## 2026-10-27 · Windows 放行后重连先证明所选 hy2 节点自己的 TCP 块
- 归属：G2（连不上有下一手，恢复留在用户所选节点）；Windows tono-core `unarmed_probe.rs`。
- 来源：基线 origin/main `668ded58c`；分支 `fix/unarmed-hy2-base-first`。
- 缺陷修复：WIN-UNARMED-HY2-SKIPS-OWN-TCP。选中 `X · hy2` 时，TCP 探测顺序改为 X、再同区其余（与 macOS `tcpCandidateNames` 一致），不再可能把选择改成另一个同区节点。
- 新增/优化：无。
- 工程与测试：`unarmed_probe::tests::a_selected_hy2_block_proves_its_own_tcp_block_before_other_exits`。
- 验证：见 PR 验证评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机；`monitor.rs` 未改。
