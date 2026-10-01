## 2026-10-01 · A12 共享 Rust 核心清点（Grok）

- 归属：运维记录，非 SHIP_PLAN 发版门。不改产品行为。
- 来源：对照 `origin/main` `50bbbbf0` 阅读 `tono-core` 的 auth、policy、签名、目录、自愈、连接、更新日记、恢复和凭据。分支 `cursor/grok-a12-report-f6c6`；仅文档。
- 缺陷修复：无。没有达到断网、崩溃、验签绕过或凭据泄漏门槛的缺陷。
- 新增/优化：`docs/agent-reports/grok-A12.md`。28 条假设里 27 条驳回；助手 DIRECT 后缀与开着的 #797 重叠，未改 `policy.rs`。
- 工程与测试：无产品代码。
- 验证：只读 `gh` 与源码。未跑 `cargo test`。
- 候选/发布：无新包，仅文档。
- 剩余限制：不声称服务进程里的 WFP 在升级后的实机状态；那不由本 crate 的日记删除单独决定。
