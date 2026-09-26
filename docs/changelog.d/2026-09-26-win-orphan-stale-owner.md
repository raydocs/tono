## 2026-09-26 · Windows：无主拦截已清、旧连接状态残留时重新给出确认恢复
- 归属：G3（客户安装/修复路径，#573 的残留）；Windows Service `core/update.rs` 的手动安装门控。
- 来源：基线 origin/main `8b5f6fcd`；红分支 `wip/win-orphan-stale-owner-20260926-red`（`5dc82b1a`），修复分支
  `fix/win-orphan-stale-owner-20260926`，[#637](https://github.com/raydocs/tono/pull/637)（Part of [#602](https://github.com/raydocs/tono/issues/602)）；未合 main。
- 缺陷修复：#573 的确认清除先由 `RemoveVergeService` 移除 WFP 与 Service，再由 `--retire-orphaned-owner` 把旧 owner 记为停止。
  这一步写盘失败时，安装中止并提示「重新运行安装器」，但 `core_should_be_running=true` 留了下来。重跑时 `begin_manual`
  看不到过滤器，不再走无主分类，owner 检查直接回 `ProtectionActive`（77），NSIS 让用户去「断开」，可此时已没有 Service 和 App
  可以断开，又是死路（#602 评论项，Codex 核实 aeb3445e 时发现）。改后：owner 检查与残留过滤器检查同样分类，拆成纯函数
  `runnable_owner_refusal`。仍有 Tono Service（含已停止，或 SCM 读不出）时仍回 77；确认没有 Service 时回 78，走已有的确认框、
  `--manual-orphan-gate`、`RemoveVergeService`、`--retire-orphaned-owner`，其中每一步都会重新检查。
- 新增/优化：无。pending 更新与其他安装器租约检查仍在此之前；过滤器检查须先通过，所以这条分支只在没有 Tono 过滤器时出现。
  NSIS、WFP、释放路径均未改。
- 工程与测试：新增一个 `#[test]` `update_manual_gate_reoffers_orphan_recovery_for_a_stale_runnable_owner`，测纯判定：
  非 runnable 时不查询 Service；有 Service 或 SCM 读不出时为 77；没有 Service 时为 78。红分支带一个保持现状（恒为 77）
  的骨架，应按最后一条断言失败，不是编译失败。
- 验证：未在本地编译（MacBook 不是构建机），只用 `rustfmt --check` 看过改动的文件（无新增格式差异）；以 `windows-ci`
  （`windows-2025`，`core::update::tests::update_*`）为准。红分支 dispatch run
  [36209604416](https://github.com/raydocs/tono/actions/runs/36209604416)，提交时尚未出结果。
- 候选/发布：仅源码，无新候选。
- 剩余限制：这一状态下 78 确认框文案（`installClearsOrphanedBlock`）仍写「拦截还在」，实际已清除；恢复路径相同，为保持窄修未改文案。
  静默/无人值守安装仍拒绝；未实机验证。
