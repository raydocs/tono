| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-REACTIVATION-SESSION-RESURRECTION | ensureDevice清除暂停标志后登录token插入失败，旧暂停会话重新获得授权 | in-PR | [#1738](https://github.com/raydocs/tono/pull/1738) | 高·已确认（受控D1故障回归） | active/pending重激活均在同batch撤旧session；并发赢家不误撤；独立复审待编排者 |

49bd0fc91用真实D1 BEFORE INSERT session触发器模拟authResult失败：设备已active/pending且标志已清零，旧live session仍1（预期0），两个分支真实RED。06a5408c2在devices.ts重新激活batch内、状态更新前用当前revoked状态和同user/device/installation约束撤销旧会话；后续token事务失败仍无法恢复旧token。
另测重激活batch自身失败：设备保持revoked/暂停标志1，旧session撤销一并回滚，但access/refresh仍401且无exit credential；不能以状态回滚恢复网络权限。
