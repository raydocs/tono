| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CP-PINNED-SILENT-WAIT | macOS 读请求：pinned 地址接受连接后不应答时没有首包预算，要等会话超时，约 60 s 后才轮到中继（文档原写「≤25 s」） | in-PR | [#1523](https://github.com/raydocs/tono/pull/1523)（Sol 终审 minor M2） | 低·推导 | [api-relay.md](../ops/api-relay.md) 已改为只在 pinned 连接失败时成立；本分支加入 GET-only、跨地址共享首包期限，hosted RED 已复现，修复后检查/独立审查证据见交付 PR 回执。未在实机复现 |

2026-10-22：旧行为（仅注入 seam）`daad6b73f6a4b1307be3bcfe5ad66bce8c24c5b4` 的 [hosted RED 39866752599](https://github.com/raydocs/tono/actions/runs/39866752599) 实际执行窄回归：逻辑时间 15 s 时连接关闭次数 `0`、预期 `1`。修复使用串行 transport 队列上的最终状态行检查，超时先关闭连接再恢复 waiter；迟到回调仅属于旧实例。POST、末路径和慢 body 不新增回退期限。父线程需完成高风险独立审查后决定后续。
