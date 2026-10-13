| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-UPDATE-REPAIR-SCRATCH | 更新恢复耗尽后的完整安装修复在混杂安装树上，`--replace-runtime` 仍拒绝与 live 文件不同的 `.rollback`/`.restore` 恢复副本，安装中止（失败关闭，到不了 `finish_manual`）；归档后恢复任务删除失败也没有重试 | in-PR | [#1307](https://github.com/raydocs/tono/issues/1307) / PR 待填 | 低·推导（P2/P3，Codex 读码，未运行） | 完整安装改用独立 scratch 名，失败更新的恢复文件原样保留；恢复任务删除重试 4 次；调度器持续拒绝时任务仍残留（无持久清理义务）；待实机（混杂树上完整安装） |
