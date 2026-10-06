| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UNARMED-DNS-KICK | macOS 后台重连对同一上行上的纯 DNS 通知（含 Tono 自己恢复 DNS）也把退避拉回 2 秒档，每档都是一次带 PF 的完整连接 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 中·已确认 | 去抖 750 ms；inconclusive 只更新基线，同一网络断开再回来仍会重启；连接中的基线规则不变；回归未在本机运行；未实机验证 |

Codex 核验 CONFIRMED。与 R4SW-MAC-RETRY-BACKOFF（fixed 42389cb9）同一退避约束的残余入口，诱因来自 MAC-UNARMED-NO-NETWORK-KICK（fixed 32fb4576）。
