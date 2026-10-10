## 2026-10-10 · Windows WFP 防护开关 `windows_kill_switch.rs` 拆成模块目录（A23）
- 归属：ops 任务，[运维计划](../ops/plan-2026-09-11.md)；Amp 待办 [A23](../ops/amp-backlog-2026-10-10.md)（D6-A，一个文件一个 PR）；影响 `apps/windows/service`。
- 来源：基线 `origin/main` 44dcb4fe → 分支 `amp/a23-split-wfp-kill-switch`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：无行为变化。8895 行的 `core/windows_kill_switch.rs` 原样移到 `core/windows_kill_switch/`：`mod.rs`（原模块说明与
  `use` 行，逐字节相同，加 `mod`/glob 再导出）、`state`、`intent`、`validate`、`rules`、`engine`、`arm`、`session`、`direct`、
  `disarm`、`policy`、`startup`、`watchdog`、`emergency`、`report`，内联 `mod tests` 移到 `tests.rs`（只少一级缩进，路径
  `core::windows_kill_switch::tests::*` 不变）。每段保持原顺序。只改可见性：原私有、被其他新文件按名引用的条目和字段加
  `pub(super)`（等于原来的模块内可见），原 `pub(super)` 改 `pub(in crate::core)`（等于原来的 `core` 可见）。WFP 规则、
  permit 表、权重、GUID、常量、调用顺序都没动（规则本身在 `wfp_model.rs`，本 PR 未改）。
- 工程与测试：纯移动的机械证明（去掉 `use`/`mod`/可见性词/空行后，旧文件与新文件行的多重集合相同；每个新文件与旧文件
  对应行段同序；测试只差缩进）见 PR 正文。tracing 日志的 target 会带上子模块名（如 `…::windows_kill_switch::disarm`），
  仓库内没有按 target 过滤或解析的代码。
- 验证：Linux orb 只跑了上述脚本，未跑 cargo（该 crate 只在 hosted `windows-ci` service job 上编译和测试）。CI 结果与
  main 上一次 service job 的测试数对比见 PR。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：只拆了这一个文件；A23 的 `connection.rs`、`dns/mod.rs`、`auth.rs` 各自另开 PR。
