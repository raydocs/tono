## 2026-09-26 · Windows 原生更新失败回滚并退休后，下一次更新不再被残留副本拒绝
- 归属：G3（同一设备先失败后成功的更新验收）；影响 Windows Service 安装器 `apps/windows/service/src/bin/install_service.rs`
  （`CoordinatedBinaryReplacement::prepare`），经 `install_service/update_executor.rs` 的原生更新执行器调用。发现 WIN-UPD-RETIRED-ROLLBACK。
- 来源：基线 origin/main `f15e95a7`；红分支 `wip/win-update-after-rollback-red`（`c306b0e9`，仅测试）；
  修复分支 `fix/win-update-after-rollback-20260926`；PR 待开；未合 main。
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
