## 2026-09-30 · Windows Service 核心运行记录损坏恢复与写入隔离

- 归属：SHIP_PLAN §2 item 10（装上会坏：损坏的 core 运行记录拒绝之后每次 Core 启动）；影响 Windows Service（`apps/windows/service/src/core/runtime.rs`）。
- 来源：main `64af499a` → 分支 `glm/win-core-runtime-record`；PR [#775](https://github.com/raydocs/tono/pull/775)；已并入 `origin/main` `b1825a3a`。损坏记录仍隔离，写入仍用唯一临时名。
- 缺陷修复：`tono-service.core.json` 解析失败时 `read_core_runtime_record` 返回 `invalid core runtime record` 且不动文件；启动对账 `reconcile_service_startup` 原样上抛，`ensure_startup_reconciled` 在每次 PrepareCoreStart/StartClash 重放同一确定性失败（StartClash 在此之前已 arm WFP bootstrap），Core 启动一直被拒，直到记录被清除（一次走到 `stop_core` 的停止/断开，或手删文件）。改后仅解析失败按 desired-state 同款恢复：改名 `<slug>.core.json.corrupt.<unix 秒>` 保留字节，改名失败再尝试删除，告警且绝不失败，读取按无记录处理（NotFound 以外的 I/O 读错误仍报错；无记录时孤儿清扫仍按镜像路径运行）。写入侧两个写者（CORE_MANAGER 下的 `start_core` 与看门狗重启路径）共用固定 `json.tmp`，并发时可截断彼此飞行中的临时文件并把混合字节提交成下次读取的损坏记录（再触发上面的卡死）；改后每次写入用唯一临时名 `tmp-<pid>-<seq>`（进程级 `AtomicU64`，同 BRICK-W11 意图临时文件的隔离方式），写/替换失败时尽力删除自己的临时文件。
- 新增/优化：无。
- 工程与测试：新增一条回归 `a_corrupt_core_runtime_record_is_quarantined_rather_than_refusing_forever`（`#[tokio::test]` + `#[serial]`：写入坏字节 → 读取为 `Ok(None)`、原文件消失、恰好一个 `.corrupt.` 兄弟文件保留字节）。未改 WFP / kill-switch 代码。
- 验证：本 Linux 云代理无 Windows/Xcode；cargo 在本会话需审批未获准，未编译、未跑测试（not runtime-verified）。hosted `windows-ci.yml` 的 `cargo test --locked --features standalone,client,test` 负责。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`desired.rs`、`dns/*`、`macos_kill_switch.rs`、`maintenance.rs` 等其余共享 tmp 写法未动（见 `2026-09-30-win-intent-tmp-race` 的同类清单）；重复损坏会在 runtime 目录留下多个 `.corrupt.<ts>` 文件（与 desired-state 现状一致）；Windows 实机未验证。
