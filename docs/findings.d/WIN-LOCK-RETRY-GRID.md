| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LOCK-RETRY-GRID | Windows 连接在 StartClash 后固定每 200 ms 向 Service 请求锁定，WinTUN 出现后平均多等约 100 ms，且每次失败都是一次带对端证明的生命周期 IPC | in-PR | [#1418](https://github.com/raydocs/tono/pull/1418) | 低·推导 | 被拒重试改为网卡别名出现即再问（App 本地每 20 ms 查一次，不授权）；拒绝前网卡已在或始终不出现时仍是原 200 ms 网格与 50 次上限；每条阶梯最多 3 次提前重试；本地查询限 100 ms，超时后本条阶梯不再查询；收益未实测；回归 `lock_retry_follows_the_tunnel_adapter` 未在本机运行 |

来源：2026-10-04 连接速度审查 S5。见 [changelog](../changelog.d/2026-10-06-windows-connect-speed.md)。
