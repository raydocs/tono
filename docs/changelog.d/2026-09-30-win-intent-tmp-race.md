## 2026-09-30 · Windows kill-switch 意图写入隔离与提交校验

- 归属：SHIP_PLAN §2 item 10（装上会坏：kill switch 意图落盘竞态）；影响 Windows Service（`apps/windows/service/src/core/windows_kill_switch.rs`）。
- 来源：基线 `d1f89c1c` → 本分支；分支 `cursor/fix-win-intent-tmp-race-8a8e`；PR 待建（目标 main）。
- 缺陷修复：意图保存与 `kill-switch.json` 共用临时文件 `kill-switch.tmp`：后继写者会删掉/覆盖前一写者飞行中的字节；`atomic_file::replace` 30 秒超时只放弃等待、不取消改名，报告超时的保存（如释放的 tombstone）之后仍可能落盘，覆盖后继连接写下的 wanted 意图（BRICK-W11）。改后每次写入使用唯一临时文件（`tmp-<pid>-<seq>`，不再预删共享 tmp），`replace` 成功后读回目的文件校验：不一致即报“未提交”错误（调用方本就按“未证明”处理并重试/回滚），不再静默保留旧意图。
- 新增/优化：无。
- 工程与测试：新增 `#[tokio::test] intent_write_isolated_tmps_and_verified_commit`（顺序写精确提交且无共享 tmp 残留；并发写不撕裂且至少最后写者自证；`TEST_INTENT_VERIFY_CORRUPT` 开关确定性地模拟 replace 与读回之间落下的陈旧改名，断言报“did not commit”）。随 `windows-ci.yml` 的 `cargo test --locked --features standalone,client,test` 跑；Linux 无 1.98 工具链，本地未编（not runtime-verified，走 hosted CI）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：在读回之后落下的陈旧改名仍未覆盖（需内核改名停顿超过一整次后继写入，已极窄，见 BRICK-W11）；`dns/mod.rs`、`dns/engine.rs`、`macos_kill_switch.rs`、`desired.rs`、`maintenance.rs` 的同类共享 tmp 写法未动；未实机验证。
