| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-DOWNGRADE-STRING-MISSED | Service 原文 release replay/downgrade refused 没被当成水位拒绝，现在更新仍可点，每次都会再断一次网 | in-PR | fix/t7-update-prep | 中·已确认 | 两条正则都认 `downgrade refused` 和 `release replay`。不匹配日志里的 “no Core replay”。未上真机 |

落到 `notCompleted` 时 `sticks` 为 false。没有放行漏洞，但每次点击都会清代理、断开、再被 Service 拒绝。
