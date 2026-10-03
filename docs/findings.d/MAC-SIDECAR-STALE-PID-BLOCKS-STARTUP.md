| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SIDECAR-STALE-PID-BLOCKS-STARTUP | macOS 旧 `tailscaled.pid` 的 PID 被同账户无关进程复用后，清理拒绝并保留标记，账户每次启动/重试均无法就绪（P3；正常网络不受影响） | fixed(2ee08662) | #788 | 中·推导 | 非空且不匹配的已验证路径改为删标记、不发信号；路径读取失败/为空仍拒绝，已验证 daemon 停止失败仍抛错；新增一个真实清理接缝 XCTest，Linux 无 Swift/Xcode，需 hosted macOS CI，未实机 |

基线 main `2effc614`，分支 `codex2/mac-sidecar-stale-pid`。`TonoSidecarService.prepareCloudOnly()` 进入 `terminateStaleDaemon(expectedExecutable:)`，原可执行路径不匹配时抛错并留下 PID 文件；`AccountSession.startCloudOnlyRuntimeThrowing()` 传播该错误，未到云出口激活或 `.ready`。

本次仅将明确无关进程的路径不匹配改为删除旧标记并记录不含 PID/路径的本地审计；`proc_pidpath` 返回失败或空路径无法证明 PID 复用，维持原拒绝，不猜测或发信号。标记删除沿用尽力清理；检查到发信号之间的既有 PID 竞争窗口未改。仅源码，无新候选；未合 main。
