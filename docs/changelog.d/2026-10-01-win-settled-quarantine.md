## 2026-10-01 · 提权超时后运行状态查询不再永久等待
- 归属：SHIP_PLAN G1。影响 Windows App 的 Run State（`core/runstate`）。
- 来源：基线 `origin/main` `d7e24ec9` → 本分支；[#923](https://github.com/raydocs/tono/pull/923)。未合 main。
- 缺陷修复：安装/修复助手超过 150 秒（或测试里的短超时）后，槽保持隔离，但 `settled` 以前要等槽被清空才会返回。清空只发生在进程重启，所以 `get_runtime_state` 和已经停在这次等待里的读取不再返回。现在隔离在放下守卫时先记下再叫醒等待者；快照仍标着操作未结束，第二个助手照旧被拒绝。
- 新增/优化：无。
- 工程与测试：`settled_returns_when_a_privileged_operation_times_out`。本机不跑 Windows `cargo test`，交给 CI。
- 验证：未在本机执行 `cargo test`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：超时之后那个已经拉起的助手进程仍然可能在跑；这次只让状态查询和后续读取不再卡死。没有实机点过 UAC 超时。
