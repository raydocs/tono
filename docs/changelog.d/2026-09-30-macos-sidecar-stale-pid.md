## 2026-09-30 · macOS 旧 sidecar PID 复用不再阻断账户启动
- 归属：SHIP_PLAN §2 第 10 条；macOS 账户云出口启动、旧 sidecar 清理。
- 来源：main `2effc614` → 分支 `codex2/mac-sidecar-stale-pid`；PR 待开；未合 main。
- 缺陷修复：旧版异常退出遗留 `tailscaled.pid`，重启后 PID 被同账户无关进程复用时，原清理拒绝并保留标记，账户每次启动/重试均无法就绪。现仅在读到非空、明确不匹配旧 daemon 的可执行路径时删除标记并返回，不向无关进程发信号；关联 `MAC-SIDECAR-STALE-PID-BLOCKS-STARTUP`（P3），正常网络不受此缺陷影响。
- 新增/优化：沿用本地审计记录 `legacy_sidecar_stale_pid_discarded`，不记录 PID 或进程路径；`proc_pidpath` 失败或路径为空不构成无关进程的证明，仍保留标记并拒绝；已验证 daemon 停止失败仍抛错。
- 工程与测试：在既有 `RuntimeConfigTests.swift` 加一个 XCTest，临时 sidecar 目录写入同账户 `/bin/sleep` 子进程 PID，调用真实 `prepareCloudOnly()`，断言标记删除且子进程仍运行；使用既有初始化接缝，无 helper 或版本变更。
- 验证：基线 `2effc614` 的上述分支；`git diff --check`、Node 记录合并读取及四个变更文件的空白检查通过；源码与测试差异逐行静态复核。Linux 无 Swift/Xcode，未编译、未跑 XCTest，需 hosted macOS CI（本轮未运行/调度）；未实机复现。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无法读取进程路径时仍会拒绝账户启动；标记删除仍沿用原有尽力清理。PID 身份检查到发信号之间的既有竞争窗口未改，本次只修明确的无关进程路径。
