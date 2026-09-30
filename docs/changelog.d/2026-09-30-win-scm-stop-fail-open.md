## 2026-09-30 · Windows 普通 Service Stop 收回非严格保护
- 归属：SHIP_PLAN §2 第 10 条（装上会坏）；Windows Service，WIN-SCM-STOP-KEEPS-BLOCK。
- 来源：main `378c165d` → 分支 `codex2/win-scm-stop-fail-open`；PR #792；未合 main。
- 缺陷修复：连接后关闭严格 kill switch，再经 SCM Stop / Preshutdown 停服务，旧路径只停 Core，留下持久 WFP 阻断及指向已停止解析器的保护 DNS。现在在 owner lifecycle 锁内先恢复 DNS，再停 Core、退役运行意图，最后调用 Disconnect 同用的 `windows_kill_switch::release()`，写解除墓碑。严格模式、原生更新 pending、仍有效的手动安装租约或 installer/repair 持闸时保留原行为；普通 owner goodbye 仍从已解除、无运行意图的状态退出。
- 新增/优化：无；复用已有 DNS/WFP 释放和更新准入，不新增 AI 阻断层，不重复 #740 的开机恢复。
- 工程与测试：新增一个 `#[test]`，`service_stop_releases_only_without_strict_or_lifecycle_ownership`，覆盖普通停止释放、严格或更新/安装生命周期占用时保留。停止标记在 lifecycle 锁内拒绝仍排队的普通及更新 IPC 写操作，防止解除后重新装屏障。Windows 整段停止清理限 60 秒，SCM wait hint 为 65 秒；失败/超时记日志后继续停止，runtime 用已有紧急恢复同用的 `shutdown_background()`，不再等待遗留 blocking worker。
- 验证：本 Linux worktree `git diff --check` 通过；逐行静态复核 Rust cfg、返回类型、锁持有范围及 await。无 Windows / Xcode，本机未编译或运行 Windows Rust 回归、未做 SCM / DNS / WFP 实机测试；hosted Windows CI 待运行，不沿用旧源码的通过记录。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`，覆盖普通 Stop / Preshutdown、严格模式及原生更新/安装接续。释放失败或超时仍是尽力恢复；DNS 恢复无法证明、WFP/意图写入失败或更新/安装证据不可读时可能留下保护，停止不无限等待。#738 的 fail-open 后 AI 阻断层不在本分支，由同一标准 release 入口后续接入。
