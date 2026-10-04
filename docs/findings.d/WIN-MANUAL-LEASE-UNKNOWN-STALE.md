| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-MANUAL-LEASE-UNKNOWN-STALE | Windows 手动安装准入把旧安装器身份读取错误当作退出，可能覆盖仍活跃的租约 | in-PR | 分支 `raydocs/fix-connection-stability-20261004` | 中·推导 | 共享准入只认可确认退出或 PID 创建时间变化；使用无映像路径读取的 process_started_at，避免确认 PID 被复用却因新进程路径不可读而长期拒绝；身份读取不确定时拒绝 InstallerLeaseHeld，带诊断并保留持久租约。相同持有者仍放行，不以路径读取错误证明死亡。`core::update::tests::update_manual_uninstall_requires_conclusive_previous_holder_death` 已补并落入现有 native-update CI 筛选；MacBook 未跑 cargo，Windows 故障注入待验。 |
