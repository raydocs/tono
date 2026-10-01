| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HEAL-SIGNOUT-DIAL | 登出不清除自愈拨号，下一账户在同名目录上会连到上一账户的备用节点 | in-PR | #874 | 中·已确认 | 只清内存会话。同一次登录里、屏障放下之前改拨备用节点仍是自愈设计。needs-hardware |

`heal::prepare` 只在首选名或住宅身份变化时重建会话。登出清了节点和路由，留下 `heal.dial` 与 `pending_dial`。下一账户的目录常有相同城市名，`dial_name` 在屏障未武装时返回旧的备用城市。回归：`sign_out_drops_the_previous_accounts_failover_dial`。
