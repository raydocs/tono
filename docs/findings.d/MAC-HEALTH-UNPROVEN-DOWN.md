| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HEALTH-UNPROVEN-DOWN | `GET /killswitch/health` 把 pfctl 超时或单次「未过滤」读成 `live: false`，已连接 App 约每分钟据此断开且 `releaseKillSwitch: false`，PF 仍武装 | in-PR | [#889](https://github.com/raydocs/tono/pull/889) | 中·推导 | 连续两次都读成未过滤仍报 down（与 supervisor 第二读相同）；省略 `live` 时当前 App 把整次健康检查当无样本；未实机 |

`health()` 原为 `(try? effectiveStatus()) ?? false`。`effectiveStatus` 对 pfctl 非 0 返回 false，超时才抛。App 在 `AppState+Connect.swift` 看到 `wanted && !live` 就断开且不释放。
