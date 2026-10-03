| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-BROWSER-DOH-FAIL-CLOSED | 会话中浏览器 Secure DNS 变 blocking 时走保留式拆线：核心停、PF 只留 bootstrap、DNS 指向死解析且不排重连，断网约 30 秒直到 helper 看门狗自行释放 | fixed(f350e97e) | [#760](https://github.com/raydocs/tono/pull/760) | 中·推导 | 显式释放本身失败（helper 需修复/管理员提示被拒）时仍按既有释放失败路径停在受保护态；错误文案与 protectedDnsNotReady 分类不变；未实机 |

2026-09-30：`AppState+Connect.swift` 浏览器审计失败分支改 `disconnect(releaseKillSwitch: true)`。macOS 无严格 kill switch，结束态本就是开放网络，这次只去掉 ~30 秒断网窗口；仍不排自动重连（浏览器设置只有用户能改，连接时 preflight 也会以 ConflictError 拒绝）。
