| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-EDGE-PAGE-ROSTER-DISCARD | `control_plane_unreachable` 把任何非 `EXIT_NODE_DISABLED` 的 401/403/404 都当作控制面应答，Cloudflare 1010/WAF 页面也会删掉离线 roster 副本；之后 Xray 重启时客户被锁在外面，直到控制面恢复 | fixed(b069ea5f0) | [#1784](https://github.com/raydocs/tono/pull/1784) | 低·已确认（红测） | 只认 Worker 的 JSON 错误体为应答；副本仍受 24 h 上限约束；200 的非 JSON 响应仍按应答处理（删副本） |
