| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-START-ERROR-WAIT | macOS 已拒绝的 Core 启动仍等待缺席的 controller，延迟原错误及失败清理 | fixed(92e004f6) | [#1376](https://github.com/raydocs/tono/pull/1376) | 中·推导 | CoreStartupReadiness 将 start/controller 并行运行，先消费 start 的失败；退出时取消并等待 controller。有效冷启动的原等待窗口不缩短；TUN/DNS 仍并行，但现在在 start 与 controller 均确认后开始。XCTest `CoreStartupReadinessTests.testRejectedStartCancelsAndDrainsPendingControllerReadiness` 已补，MacBook 未运行；hosted CI/实机耗时待验，不声称成功路径加速。 |
