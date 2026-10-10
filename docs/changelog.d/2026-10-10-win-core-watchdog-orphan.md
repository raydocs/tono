## 2026-10-10 · Windows Service：watchdog 恢复中再启动不再留下孤儿 watchdog（草稿）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，2026-10-10 卡死/竞态专项审计的遗留修复；不是 ship gate，不进 0.0.75。
- 来源：基线 main → 分支 `amp/win-core-watchdog-orphan`（工作者在额度耗尽时中断，主执行保存补丁后推送）。
- 缺陷修复：[WIN-CORE-WATCHDOG-ORPHAN](../findings.d/WIN-CORE-WATCHDOG-ORPHAN.md)。`start_core` 先调用
  `stop_supervised_core_before_start`：PID 非 0 或仍登记着 watchdog 时都先 `stop_core`（join），失败报 Fatal。
- 工程与测试：`restart_while_recovering_tests::a_start_while_the_watchdog_recovers_keeps_the_new_cores_identity`（`feature = "test"`）。
- 验证：本机不跑 Windows Service cargo；以托管 Windows CI 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未经独立评审；需 Sol 高风险终审后才能转 ready。
