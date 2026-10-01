## 2026-09-30 · Windows 所选出口被目录移除时非严格放行

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）。Windows App 的目录同步与连接释放；按所有者 2026-09-30 决定覆盖非严格会话的 Protected Offline 取舍。
- 来源：main `378c165d` → 分支 `codex2/win-catalog-exit-removed-release`；PR #791；未合 main。
- 缺陷修复：已连接或连接中的所选出口被新目录移除时，原先一律 `tono_stop_core(false)`，Core 停止而 Service 的健康 Blocked WFP 持续全阻断。非严格会话改走既有协调释放（DNS → Core → WFP），严格杀开关仍停 Core 并保留阻断。关联 `WIN-CATALOG-VANISHED-EXIT-BLOCKS`。
- 新增/优化：无新能力。保留 `catalog_requires_choice` 和不自动重连；用户仍须选择存活节点。正常连接时的 AI 服务阻断不变；没有新增 AI 层，释放后的窄 AI 阻断由独立 [#738](https://github.com/raydocs/tono/pull/738) 接入标准释放路径。
- 工程与测试：`switch.rs` 的分离工作任务直接持有并向 `release_explicit_with_guard` 转交独占 guard，避免重取同一写锁；`invalidate_connection(releases)` 记录非严格释放意图。新增一条 `vanished_exit_releases_only_without_strict_kill_switch` 回归；`connection.rs`、`connection_plan.rs` 的相关注释同步规则。
- 验证：本环境不能构建 Windows-only Rust；未编译、未运行 Rust 回归，也未运行 Xcode/Swift。hosted Windows CI 待跑；已逐行复核类型、锁与异步边界，`git diff --check` 通过；记录读取工具能识别新发现条目。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。尚未实机验证目录移除后的 DNS 恢复、Core 停止与普通互联网出口，以及严格模式继续阻断；当前 Windows App 没有严格偏好，沿用 `strict_kill_switch_explicit(None)`。释放被拒仍由既有协调路径保留失败状态，不在本次改写；#738 尚未合入本基线，不能声称本次已提供释放后的窄 AI 阻断。
