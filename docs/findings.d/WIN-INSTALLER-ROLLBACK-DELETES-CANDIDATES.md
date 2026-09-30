| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-INSTALLER-ROLLBACK-DELETES-CANDIDATES | Windows 安装器协调发布遇临时文件锁，成功回滚后删除 core/App 的 `.next` 候选，NSIS 不重新暂存的自动重试因此持续校验失败并中止安装 | in-PR | #801 | 低·推导 | 仅源码；Windows Rust 编译/测试与实机 NSIS 重试未运行，等待 hosted CI；错误 5 也可能为持续 ACL 拒绝；准备阶段临时失败仍删除候选，未修 |

复核：`CoordinatedBinaryReplacement::cleanup` 包含候选文件；旧字节与旧 Service 恢复成功后调用该清理；`installer.nsi` 的 `serviceInstallAttempt` 重试不经过 `File` 暂存步骤。
修复：仅 Windows 错误 5/32/33 且回滚与旧 Service 恢复成功时，保留 core/App 候选并清理冗余恢复副本；其他提交与准备/校验失败清理不变，不动无法收敛时的恢复证据。
安全边界：下一次 `--replace-runtime` 重新验证固定安装路径、core 编译期摘要，App 重新测量摘要，`prepare` 再验证各候选摘要；不改运行时网络释放、AI 服务屏障或严格 kill switch。
