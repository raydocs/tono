| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R3KS1-PENDING-EXPIRY | 未提交的 DIRECT 重载（Bracket/Pending）过期后 Service 收窄到 Blocked 并视为健康，App 已死时非严格机器永久无网 | fixed(7b8d6fa46) | [#1056](https://github.com/raydocs/tono/issues/1056) · [#1625](https://github.com/raydocs/tono/pull/1625) | 高·推导（P1，需 App 在重载中途死亡） | 修复为有界宽限后的非严格释放（决定 116，provisional 90 s）；严格模式保持 Blocked；待实机 |
