| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1452-opus-F1 | 登录凭据本地持久失败后同步等待旧会话远端撤销，断网时已登出提示被完整网络资源超时拖住 | in-PR | [#1452](https://github.com/raydocs/tono/pull/1452) | 低·已确认 | Jev 3c29e3f0 opus:F1，Codex 核验 confirmed minor；一轮改为 2 秒合作式取消预算并排空撤销子任务，避免后台 cleanup 跨进下一次登录；同一窄 XCTest 持有网络响应、要求 5 秒内回报本地拒绝（超时仍保留失败并清 fixture）。增量 f5c2d4d9 在源码 8139c5f0 PASSED、复核关闭本项（无剩余 minor）；最终精确记录 head CI 待验，尚未合 main；URLSession/Network.framework 取消、真实设备慢网体验留 G1/G2，不称绝对硬实时期限。 |
