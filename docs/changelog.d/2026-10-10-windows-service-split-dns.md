## 2026-10-10 · Windows 服务 `dns/mod.rs` 纯拆分（A23）
- 归属：ops 任务，[运维计划](../ops/plan-2026-09-11.md)；Amp 待办 [A23](../ops/amp-backlog-2026-10-10.md)（D6-A，一个文件一个 PR）；
  影响 `apps/windows/service/src/core/dns/`（受保护路径：DNS/NRPT、特权服务、fail-closed）。
- 来源：基线 `origin/main` ed00fe84 → 分支 `amp/a23-split-dns`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：无行为变化。`dns/mod.rs`（3708 行）按原顺序原样移到同目录 14 个子模块：`snapshot`（快照与加密 DNS
  捕获旁文件）、`self_write`、`name_servers`、`orphaned`、`enable_decisions`、`restore_proof`、`uninstall`、`recovery`、
  `markers`、`resolver_policy`（NRPT 与策略冲突观测）、`engine_ops`（有界引擎调用与 `engine_*` 包装）、`status_cache`
  （状态缓存与 watchdog）、`enable`、`restore`。mod.rs 保留模块文档、共享常量、`DNS_OPERATION`/`DNS_LAST_ERROR` 等门面状态、
  `test_hooks` 与 `mod engine;`/`mod tests;`。唯一的非移动改动：子模块 `use super::*;`，mod.rs 的 `mod`/glob 再导出，
  以及原私有顶层项加 `pub(super)`（143 处，含 `InterfaceDohEntry` 四个字段与 `SelfWriteWindow::open`）——可见范围仍是
  `crate::core::dns` 及其子模块，与原来私有于 mod.rs 完全相同；`pub`/`pub(crate)` 项不变。`engine.rs`、`tests.rs`、
  `native_apply*.rs`、`apply_test_io.rs` 未改。
- 工程与测试：机械证据（脚本见 PR 正文）：去掉空行、`use`/`mod` 声明行和可见性记号后，旧文件与新文件合集的行多重集
  完全相同（各 3483 行）；每个新文件都是原文件的有序子序列。
- 验证：本机（Linux orb）不跑服务的 cargo（任务规则）；`rustfmt --check` 只用来确认 15 个文件都能解析。
  可见性/glob 语义（`pub(super)`、glob 再导出、`Context as _` 经 glob 生效、`pub use` 链）用 rustc 在临时 toy crate 上确认。
  编译与测试由 hosted `windows-2025` CI 跑，测试数对比见 PR 正文。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：为保持纯移动未跑 rustfmt（加 `pub(super)` 后有几行超宽，原文件本来也不是 rustfmt 干净的，CI 不查格式）；
  mod.rs 顶部文档里 “in this file” 的说法未改。
