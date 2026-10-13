| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-UPDATE-REPAIR-SCRATCH | 更新恢复耗尽后的完整安装修复在混杂安装树上，`--replace-runtime` 仍拒绝与 live 文件不同的 `.rollback`/`.restore` 恢复副本，安装中止（失败关闭，到不了 `finish_manual`）；归档后恢复任务删除失败也没有持久重试 | open | [#1307](https://github.com/raydocs/tono/issues/1307) / [#1621](https://github.com/raydocs/tono/pull/1621) | 低·推导（P2/P3，Codex 读码，未运行） | 需要在修复锁下识别持久计划所属的恢复文件并给完整安装独立 scratch 命名空间，并持久化恢复任务清理义务；未知恢复文件仍必须严格拒绝；待实机 |
