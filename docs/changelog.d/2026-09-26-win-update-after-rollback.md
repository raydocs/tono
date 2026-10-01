## 2026-09-26 · Windows 原生更新失败回滚并退休后，下一次更新不再被残留副本拒绝
- 归属：G3（同一设备先失败后成功的更新验收）；影响 Windows Service 安装器 `apps/windows/service/src/bin/install_service.rs`
  （`CoordinatedBinaryReplacement::prepare`），经 `install_service/update_executor.rs` 的原生更新执行器调用。发现 WIN-UPD-RETIRED-ROLLBACK。
- 来源：基线 origin/main `f15e95a7`；红分支 `wip/win-update-after-rollback-red`（`c306b0e9`，仅测试）；
  修复分支 `fix/win-update-after-rollback-20260926`；[#657](https://github.com/raydocs/tono/pull/657)；未合 main。
- 缺陷修复：发布失败时 `rollback_plan` 从 `.rollback` 复制还原并保留副本（设计如此），已验证 Disconnect 的 `retire_rolled_back`
  只归档记录不动文件，于是副本留在安装目录。下一次更新在 consume 之后调用 `prepare`，对残留副本严格拒绝，
  执行器转为 Uncertain，该设备此后每次原生更新都失败。现在 `prepare` 对 `.rollback`/`.restore`/`.publish` 走已有的
  `adopt_or_refuse_update_scratch`：只有副本与当前安装文件字节完全相同（不含任何恢复信息）才删除；内容不同、读不出或非普通文件仍拒绝。
  手动安装器路径在发现阶段已用同一规则，行为不变。
- 新增/优化：无。
- 工程与测试：新增 `update_executor::tests::update_after_a_retired_rollback_prepares_past_the_retained_copies`
  （真实 store：consume、首个成员发布后注入失败、回滚、RolledBack、请求并验证 Disconnect、`retire_rolled_back`，再对三个成员以新字节 `prepare`）。
  第二次更新的 consume 未重放（fixture 只有一个签名 release sequence），`prepare` 即执行器 consume 之后的第一步；
  `collect_candidates` 因 `verify_tree` 的 ACL 校验无法在临时目录运行，测试直接调用 `prepare`。已有
  `stale_rollback_evidence_is_never_overwritten`（内容不同的副本仍拒绝）不变。
- 验证：MacBook 未运行 cargo；红分支 windows-ci run 36227225468 以该测试断言失败（service 作业，28 passed，1 failed）；修复以 PR 的 windows-ci 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Service 侧退休路径仍不删除副本，清理推迟到下一次更新的 `prepare`；未实机验证先失败后成功的完整流程。
- **续记（2026-09-26，#657 评审 4981e1fa 确认 opus:F1（minor））**：上一版只清与安装字节相同的残留，但 `.publish` 是 `publish` 的暂存输出，
  装的是本次尝试的新字节，从不是恢复副本。成员的发布改名失败（所有者 G3 计划的注入：对 `C:\ProgramData\Tono\bin\tono-service.exe`
  持只读、不允许删除的句柄）→ 回滚成功 → 退休后，目标是旧字节而 `.publish` 是新字节，下一次 `prepare` 仍拒绝。
  现在执行器在 consume 之后、`collect_candidates` 之前运行 `clear_retired_publish_scratch`：只对存储根下 `retired-<id>.json` 记为
  RolledBack/Uncertain（即经 `retire_rolled_back` 退休）的尝试，读其保留的 `<id>/replacement.json`，成员目标在安装根或 Service 目录内、
  无 `..`、`.publish` 路径与目标绑定，且文件字节等于该成员的 new digest、目标等于 old digest，才删除这个 `.publish`；
  归档或计划读不出、内容不符的一律跳过，留给 `prepare` 拒绝（fail-closed 不变）。`.rollback` 的处理不变。
  测试：新增 `update_executor::tests::update_after_a_retired_failed_publish_rename_prepares_past_its_staging_file`
  （真实 store 与计划位置，以拒绝删除共享的句柄让 `tono-service.exe` 的发布改名真实失败，回滚、退休后运行预清理再 `prepare`）；
  红分支 `wip/win-update-after-rollback-red2`（`0ea6ad23`，基于 `a31e7dd1`，测试 + 不清理任何文件的骨架），windows-ci run 36228989902
  以该测试断言失败（service 作业 29 passed，1 failed：`tono-service.exe.publish` 被拒绝），两条前置断言均通过。
  上一版 `a31e7dd1` 的 windows-ci run 36227911577、36227899484 通过。MacBook 未运行 cargo（只用 rustfmt 解析过改动文件），以 PR #657 的 windows-ci 为准。
  剩余限制更新：没有保留计划或归档的 `.publish`（如更早版本或手动清理过证据）仍拒绝，需要人工处理；预清理本身的跳过分支没有单元测试覆盖。
