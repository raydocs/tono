## 2026-10-13 · Windows 更新恢复耗尽后的完整安装在混杂安装树上也能走完
- 归属：SHIP_PLAN §2 item 10 范围外的 Windows Service 更新事务加固（issue #1307 续，#1621 的 F3/F4）；分支 `claude/svc-repair-scratch`；尚未合 main。
- 缺陷修复：恢复耗尽的更新记录由完整安装修复（决定 118），但混杂安装树上失败更新留下与 live 文件不同的 `.rollback`/`.restore`/`.publish`，完整安装的 `--replace-runtime` 仍拒绝并中止，到不了 `--manual-update-finish`。现在安装器持有修复锁（耗尽的 Consumed/Uncertain 记录旁、`repair_lease_held`）时，自己的事务改用独立的 scratch 名（`.install-rollback`/`.install-restore`/`.install-publish`），失败更新的恢复文件不读取、不采纳、不删除，仍是旧版本的证据；安装自己的残留照旧严格拒绝，卸载与 NSIS 清理列表新增这些名字。修复未完成期间 helper 在安装目录留下标记 `.update-repair-evidence`，NSIS 的 `RemoveKnownLegacyPayload` 见到标记就保留失败更新的 `.rollback`/`.restore`/`.publish`（否则安装第三个版本会在记录仍 pending 时把唯一的旧版本备份清掉），`--manual-update-finish` 清除标记；证明身份后目标侧备份照旧由 finish 释放。读不到状态或不是修复锁持有者时仍用更新的原名（严格）。归档后删除恢复任务失败时重试 4 次（调度器短暂拒绝不再留下每次开机都失败的任务）。
- 新增/优化：无。
- 工程与测试：`update_repair_install_keeps_stale_update_evidence_and_uses_its_own_scratch`（旧代码红：安装在失败更新的恢复文件上中止）、`update_repair_lease_is_held_only_by_the_holder_beside_a_pending_exhausted_attempt`、`update_recovery_task_retire_is_retried_after_the_archive`、`update_repair_marker_is_cleared_once_and_a_missing_one_is_fine`、打包测试 `NSIS keeps the failed update recovery copies while a repair install is unfinished`（后几个针对新增函数，旧代码无法编译，不是红）。未在本机运行 cargo。
- 验证：见 PR 正文；高风险（特权路径/生命周期/发布信任），合并前需要独立 Codex 审查。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无实机验证（混杂树 + 耗尽记录上跑完整安装）；调度器持续拒绝删除时恢复任务仍会残留（只有有限次重试，没有持久清理义务）。
