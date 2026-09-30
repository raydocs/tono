| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SWITCH-CLEANUP-HOLDS-RELEASE | Windows 热切换逐条清理旧出口连接，控制器挂起时累加超时并占用生命周期写锁，拖延断开与恢复互联网 | in-PR | 待开 | 中·推导 | 未编译或运行 Windows Rust 测试；hosted Windows CI 待跑；`needs-hardware`，未实机验证控制器挂起时的释放时延 |

获取连接和 DELETE 循环共用 3 秒总预算；连接取消或代次变化即停，首个 DELETE 错误即退。清理保持尽力而为，不因清理失败中止切换。新增一个暂停时钟回归，断言大量连接不会按每条 2 秒累计占用生命周期写锁，并在清理结束后允许后继释放取得锁。来源与验证边界见 [本轮更新](../changelog.d/2026-09-30-win-switch-cleanup-routing.md)。
