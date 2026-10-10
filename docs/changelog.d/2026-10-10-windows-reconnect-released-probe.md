## 2026-10-10 · Windows 受保护重连失败并释放网络后，交给无隧道探测继续恢复
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），中国大陆连通性审计（Windows）；`apps/windows/app/src-tauri/src/tono/connection/`。
- 来源：基线 origin/main 3d973f95；分支 `amp/win-reconnect-released-probe`；未合 main。
- 缺陷修复（[WIN-RECONNECT-RELEASED-NO-RETRY](../findings.d/WIN-RECONNECT-RELEASED-NO-RETRY.md)）：重连阶梯（启动续连、Retry now）、换节点重建和策略重建的重连
  一旦失败，`fail_connect` 按非严格计划释放原网络；阶梯只在保护还在时给下一次延迟，于是直接结束，且不像用户连接的 fail-open 和健康检查释放那样
  启动无隧道探测，电脑一直断开。现在这三处失败后若网络已释放（`failure_released_the_network`），启动 `unarmed_probe::spawn_after_release`；保护还在时照旧走阶梯。
- 新增/优化：无。失败计划表、WFP、严格 kill switch 路径、探测器本身不变。
- 工程与测试：`connection/tests.rs` 新 `#[test]` `a_failed_reconnect_that_released_the_network_hands_over_to_the_unarmed_probe`：
  用真实 `ConnectionFsm` 走「已连接 → 隧道断 → 重连失败 → 非严格释放」，断言阶梯不再给延迟、且判定为应交给无隧道探测。
- 验证：本机（Linux orb）不跑 `src-tauri` 的 cargo；以托管 Windows CI `ci-gate` 为准。三处调用点的接线没有 AppHandle 级测试（仓库无 Tauri mock）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：高风险（连接生命周期），合并前需独立评审回执；没有系统睡眠/唤醒事件处理；探测器选中的可能是同地区另一节点（既有行为）。
