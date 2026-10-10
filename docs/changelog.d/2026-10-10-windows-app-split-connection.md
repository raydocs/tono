## 2026-10-10 · Windows 应用 `tono/connection.rs` 纯拆分（A23）
- 归属：ops 任务，[运维计划](../ops/plan-2026-09-11.md)；Amp 待办 [A23](../ops/amp-backlog-2026-10-10.md)（D6-A，一个文件一个 PR）；
  影响 `apps/windows/app/src-tauri/src/tono/connection*`（连接 FSM / 生命周期，AGENTS 高风险类）。
- 来源：基线 `origin/main` 681f1e6f → 分支 `amp/a23-split-connection`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：无行为变化。4006 行的 `connection.rs` 按原顺序原样移到 `connection/` 下 6 个新文件：`attempt`（一次连接尝试：
  准入、服务检查、阶段、失败证据）、`entry`（`connect` 入口与失败后的自愈分派）、`guards`（§6.1 守卫）、`outcome`（失败决策表
  与记录）、`controller_error`（受限、脱敏的 Mihomo 控制器错误摘要）、`tests`（原内联 `mod tests`，只少一级缩进；字符串
  续行逐字节不变；测试路径 `tono::connection::tests::*` 不变）。`connection.rs` 保留模块文档、`mod`/`use` 门面、会话时钟、
  `BoxedTask` 与 `kill_switch_mode_key`。唯一的非移动改动：新文件开头一行 `//!` 与 `use super::*;`；`connection.rs` 加 `mod`
  与 `use` 行（只给测试用的加 `#[cfg(test)]`，与已有写法一致）；17 处原私有项/字段加 `pub(super)`（等于原来私有于
  `connection` 的可见范围）。`pub`/`pub(crate)` 不变；没有逻辑、常量、await 顺序或锁的改动；`connection.rs` 中早先拆分留下的
  连续空行合并为一行。
- 工程与测试：机械证据（脚本与输出见 PR 正文）：去掉空行、`//!`、单行 `use`/`mod` 声明（及其上方 `#[cfg(test)]`）与可见性记号后，
  旧文件与 7 个新文件的行多重集合完全相同（各 3557 行）；每个文件都是原文件的有序子序列；测试体除一级缩进外逐行相同。
- 验证：Linux orb 只跑了上述脚本，`rustfmt --check` 只当解析器用（全部可解析）；`use super::*` 对外部 crate 宏、`as _` trait
  导入、未用 `pub(crate) use` 警告的行为用 rustc 1.98.1 在临时 toy crate 上确认。未在本机跑该 crate 的 cargo。编译与测试由
  hosted `windows-ci` app-rust job 负责，前后测试名与数量对比见 PR。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：为保持纯移动未跑 rustfmt；`tests.rs` 仍有约 2900 行（测试名需保持不变，故未再拆）；历史文档里 `connection.rs:<行号>`
  的引用未改。
