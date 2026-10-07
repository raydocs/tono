| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M1-INSTALL-GUARD-RECOVERY | 更新账本仍有 consumed 事务时普通安装无法直接修复 helper，即使执行器已停止 | open | [#1444](https://github.com/raydocs/tono/pull/1444) | 中·已确认 | 必须设计普通安装前的显式退休：先验证真实 Disconnect 与 unprotected 观察、原始组件哈希，再清理执行器并归档账本；只读查询须与执行守卫预测同一准入。当前守卫保守拒绝全部未提交事务，不能用 blocked 或单独的断开请求放行。 |

2026-10-07：#1444 审查发现按 blocked/断开请求放行会先改写组件，而现有 `retireResolved` 随后因原始组件哈希不符永久拒绝退休；本轮撤销该放宽，保留独立恢复设计为 open。
