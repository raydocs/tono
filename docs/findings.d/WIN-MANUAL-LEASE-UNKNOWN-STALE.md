| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-MANUAL-LEASE-UNKNOWN-STALE | Windows 手动安装准入把旧安装器身份读取错误当作退出，可能覆盖仍活跃的租约 | in-PR | 分支 `raydocs/fix-connection-stability-20261004` | 中·推导 | 共享准入只认可确认退出或 PID 创建时间变化；身份读取不确定时拒绝 InstallerLeaseHeld，带诊断并保留持久租约。相同持有者仍放行，不以路径读取错误证明死亡。`core::update::tests::update_manual_uninstall_refuses_unreadable_previous_holder_without_replacing_lease` 已补并落入现有 native-update CI 筛选；MacBook 未跑 cargo，Windows 故障注入待验。 |
