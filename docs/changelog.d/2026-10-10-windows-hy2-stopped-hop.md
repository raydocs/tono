## 2026-10-10 · Windows hy2 自动切换：被停止的自动 hy2 尝试让下次回到 Reality
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），中国大陆连通性审计（Windows）检查项 2；A17 遗留；`apps/windows/crates/tono-core/src/hy2_switch.rs`、`apps/windows/app/src-tauri/src/tono/connection/heal.rs`。
- 来源：基线 origin/main 3d973f95；分支 `amp/win-hy2-stopped-hop`；未合 main。
- 缺陷修复（[A17W-STOPPED-HOP-STICKS](../findings.d/A17W-STOPPED-HOP-STICKS.md)）：自动 hy2 尝试在连上前被停止时结果被忽略，记忆和计数不变；
  UDP 被丢的网络上 hy2 尝试会挂到用户放弃，于是每次都再拨 hy2。现在 `Hy2AutoSwitch::note_stopped` 清掉该节点的 24 h 记忆和 Reality 失败计数，
  下次无保护尝试拨 Reality；不加退避（[决定 088](../decisions/088-2026-10-10-stopped-hy2-hop-returns-to-reality.md)，provisional）。
- 新增/优化：无。A18 开关、启动前复核、装甲下原地重连、手选 hy2 行、节点 443 均不变；没有新协议。
- 工程与测试：tono-core 新 `#[test]` `a_stopped_automatic_hy2_attempt_dials_the_reality_block_next`。
- 验证：Linux orb：`cargo test --ignore-rust-version --locked -p tono-core --lib hy2_switch` 2 passed；
  `cargo clippy --ignore-rust-version --locked -p tono-core --all-targets -- -D warnings -A clippy::collapsible_if -A clippy::too_many_arguments` 无告警。
  `src-tauri` 一侧（`heal.rs` 接线）本机不跑 cargo，以托管 Windows CI 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：高风险（连接 FSM），合并前需独立评审回执；`Stale` 无法区分「用户停止」与「被新的转换取代」，两者同样处理。
