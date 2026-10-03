| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WECHAT-PATH-RECONNECT | Windows 签名 reviewed direct-app 路径变化走原地恢复并停用监视腿，TUN 健康时新路径整场会话不生效（仅错路由） | fixed(ef743518) | 分支 `codex/win-wechat-path-reconnect` | 中·推导 | 改为不允许原地恢复的受保护重连；Windows CI/真机未验证 |

来源：GLM-5.3 bug hunt #10（`monitor.rs` ~334-348，main `ba7c8ae1`）。
