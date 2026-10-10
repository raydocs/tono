| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CP-RETRY-OLD-ORDER | macOS 登录：后台握手探测（≤5 s）完成前用户立刻重试，会沿用旧的「系统 DNS 优先」顺序，可能再等最多 45 s | open | [#1523](https://github.com/raydocs/tono/pull/1523)（Sol 终审 minor M1） | 低·推导 | 只是多等一段有上限的时间：不会永久离线，也不会重放 POST。位置 `TonoAPIClient.swift` L1316–1318、L325–358。未在实机复现 |

来源：#1523 的 GPT-6.1 Sol 终审回执（覆盖 `72ba858c`），以 minor 记为 open，不阻塞 0.0.75。
