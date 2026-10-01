## 2026-10-01 · 核心日志在启动交接窗口不再触发所有者恢复
- 归属：SHIP_PLAN G1。影响 Windows App 的 `core/service`。
- 来源：基线 `origin/main` `4453e258` → 本分支。未合 main。
- 缺陷修复：托盘「核心日志」走 `get_clash_log_snapshot_by_service`。服务回 `NotActive` 时它立刻做所有者丢失恢复：清会话、把运行模式标成没在跑。StartClash 自己会先清会话再等回复，所以连接过程中打开日志会踩中这次启动。现在只有本地还握着会话时才恢复。
- 新增/优化：无。监视器的三次去抖不变。诊断采集本来就不恢复。
- 工程与测试：`a_core_log_snapshot_does_not_recover_during_our_own_start_handoff`。本机不跑 Windows `cargo test`，交给 CI。
- 验证：未在本机执行 `cargo test`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有在实机上于连接过程中打开核心日志。会话仍在而服务说不是我们时，打开日志仍会恢复。
