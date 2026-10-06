| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HEALTH-STALE-ROUTE | macOS 换节点结束并清除标记后，旧健康探测可将失败计入新线路 | in-PR | 分支 `raydocs/fix-connection-stability-20261004` | 中·推导 | Coordinator 单独追踪 switch/reload 的 routeOperationGeneration；探测前捕获路由及保护代，返回后先核对再发布偏好或失败。保护代本身不因单纯换节点推进。XCTest `AppStateCoreMonitorTests.testCompletedNodeSwitchDiscardsHealthFailureFromPreviousRoute` 已补；MacBook 未运行，hosted CI/设备竞态待验。 |
