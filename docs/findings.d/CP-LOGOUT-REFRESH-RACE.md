| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-LOGOUT-REFRESH-RACE | 登出未把刷新轮换的后继会话纳入撤销，成功返回后凭据仍可能有效 | in-PR | 待开 | 低·推导 | 源码与 SQLite 已复核；Worker Vitest 被沙箱 localhost 监听限制阻断，待 hosted CI；独立旧会话问题另见 H17-G-F5 |

修复沿现有 `sessions.successor_id` 在原登出 batch 内撤销本用户的轮换链，包括已撤销中间会话之后的有效后继；无迁移，不扩大到独立会话。
