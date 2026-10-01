## 2026-10-01 · Windows 原生更新：Prepare 预先拒绝执行器无法发布的新成员
- 归属：G3 / Windows 原生更新（Service `core/update.rs`、`tono-service-install` 执行器）。
- 来源：基线 main `509ebde2` → 分支 `claude/r4-win-update-new-member-preflight`；PR [#1289](https://github.com/raydocs/tono/pull/1289)；未合 main。
- 缺陷修复：R4-WIN-UPDATE-NEW-MEMBER。原来新增文件的签名包在执行器里才失败，此时 Service 已停、App 已关、序号已消耗，原生重试被当作重放 → 现在 Prepare 在停 Core 之前就以同一条规则拒绝，网络和序号都不动。
- 新增/优化：无。执行器改为复用库里的 `new_member_is_sing_box`，规则只保留一份。
- 工程与测试：新增一个 Windows 单测 `prepare_refuses_a_payload_member_the_executor_cannot_publish`。
- 验证：本机只做读码与 `rustfmt --check`（新增代码无格式差异；文件原有的格式差异不是本次引入）。Windows CI 结果见 PR。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware；真实安装包新增成员的端到端路径未实机验证。
