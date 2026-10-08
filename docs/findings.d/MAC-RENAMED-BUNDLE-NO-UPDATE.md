| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-RENAMED-BUNDLE-NO-UPDATE | /Applications 里改名的副本（「Tono 2.app」等）能运行（守卫只看父目录，`AppDelegate.swift:20-31`），但原生更新只认 `/Applications/Tono.app`（`UpdatePackage.swift:49-58`），这些机器停在当前版本 | open | — | 中·推导（读码，2026-10-08 安装审查） | 修法：守卫改成精确路径并提示改名，或更新失败时给出指引；改 app，进 0.0.76 |
