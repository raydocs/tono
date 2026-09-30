| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CATALOG-ROUTING-CHANGE-STALE-RUNTIME | Windows 已连接会话只更新目录住宅路由而不重建核心，后续热切换删除仍在拨号的旧住宅端点许可 | in-PR | #787 | 中·推导 | 未编译或运行 Windows Rust 测试；hosted Windows CI 待跑；`needs-hardware`，Connecting 阶段路由更新的原行为未改 |

目录提交前比较 homeProxy、home_socks5 与解析后的同名住宅节点拨号身份；仅已连接且住宅路由变化时，在状态锁外按原连接代次复用保持保护的冷重建路径。选择/策略写锁由独立任务持有直到重建完成，避免账户同步取消中途放弃清理或期间热切换使用未生效的新住宅路由。新增一个纯判定回归，覆盖住宅端点、身份和路由变化，并确认默认出口提示、无关出口身份变化及目录增长不触发住宅重建。来源与验证边界见 [本轮更新](../changelog.d/2026-09-30-win-switch-cleanup-routing.md)。
