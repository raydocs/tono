| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-PREFLIGHT-STALE-SELECTION | Windows 恢复 TCP 预检在 Connecting 准入前等待，空闲改选未推进代际，随后仍连接旧快照而界面显示新服务器 | fixed(ce28924d) | #798 | 低·推导 | P3；预检最多 2.5 秒；纯比较回归已加但无 Cargo 未执行，hosted Windows CI 与实机待验证 |

`guard_snapshot` 同时捕获用户的 `selected_node`，不拿自愈备用拨号节点冒充用户选择。预检后在 `begin_attempt` 的同一状态锁内比较当前选择，变化则以 `Stale` 退出，不进入连接阶段。现有 `connection.rs` 测试模块只新增一个窄回归，覆盖未变、改选和清空。
