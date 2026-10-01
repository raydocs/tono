## 2026-09-30 · Windows 签名微信路径变化触发真实重连
- 归属：SHIP_PLAN §2 item 10；Windows App 连接监视器 `monitor.rs`，发现 WIN-WECHAT-PATH-RECONNECT。
- 来源：基线 `5d46b896` → 分支 `codex/win-wechat-path-reconnect`（本分支 PR），未合 main。GLM-5.3 发现，Codex gpt-6.1-sol（effort xhigh）实现，审阅后精简提交。
- 缺陷修复：签名 reviewed direct-app（微信）路径变化时，监视腿调用 `handle_network_change`（允许原地恢复）；TUN 健康时结果是 RecoveredInPlace，不重连，新路径整场会话都不生效，随后这条腿还把自己停掉。现在改为 `handle_network_change_inner(…, false)`，与浏览器 DNS 腿和 `handle_policy_behavior_change` 一样走既有受保护重连；不允许原地恢复时结果恒为 Handled，旧任务退出，由新代际任务继续监视，不再需要 `watching_wechat` 停用标记。
- 新增/优化：无；沿用既有入口守卫、代际检查与受保护重连路径。
- 工程与测试：无新单测。该选择是常量参数，抽成返回常量的函数再测只是同义反复；行为由 `handle_network_change_inner` 在 `allow_in_place == false` 时不返回 RecoveredInPlace 保证（读码确认）。
- 验证：Tauri App 在 Linux box 上无法离线编译（缺依赖），由 Windows CI 编译测试。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需真机（静杰批次）验证路径重新发现、重连和网络连续性；路径若持续变化，每 2 分钟最多一次受保护重连。
