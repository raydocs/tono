| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-RELAY-AUTH-AGGREGATE | 公开透传中继只按邮箱/challenge/installation限流，轮换身份可无限触发D1写入 | in-PR | [#1738](https://github.com/raydocs/tono/pull/1738) | 中·已确认（Claude审查与D1回归） | 每个精确relay源IP聚合200次/900秒；共享预算极端被耗尽时仍429重试，不使用宽泛ASN豁免 |

49bd0fc91回归跨email-start/oidc-start/oidc-verify用不同subject耗尽同一relay cap，修前第三次不拒绝，真实RED。06a5408c2在login.ts的三个限流入口增加共用聚合桶，保留原subject上限；配置RATE_LIMIT_RELAY_AUTH_IP，429沿用窗口Retry-After。另一relay源IP不共桶，直连保留原IP限额。
