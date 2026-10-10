| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-RETAIN-NO-RELAY | macOS：连接中开始原生更新时，Prepare 把空的 apiHosts 带进 retainBootstrap；若 Execute 失败，armed 状态下没有任何控制面放行（#1507 之后是中继，之前是 Cloudflare），账号/API 恢复要等到明确断开或重新 arm | open | [#1507](https://github.com/raydocs/tono/pull/1507)（Sol 终审 minor M1） | 中·推导 | 保护没有被绕过（保持 fail-closed），用户断开就能恢复。#1507 之前就存在。位置 `AppState+Connect.swift` L385–391、`KillSwitchManager.swift` L297–304/L1393–1400、`UpdateRuntime.swift` L61–71、`KillSwitchPF.swift` L146–149。未在实机复现 |
