| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-LOGS-STREAM-ROUTE-CONTEXT | 住宅路由上下文提交只重建连接流，logs 流旧 runtime 缓冲行按新上下文分类，可产生假 managed_direct_group_failed_over | in-PR | [#762](https://github.com/raydocs/tono/pull/762) | 中·推导 | 假事件未在实机日志回溯确认；XCTest 未在本机运行，hosted CI 执行；测试为确定性注入（enqueueLog，无网络 fixture），旧任务在途回调丢弃未在测试中覆盖 |

`commitResidentialRouteAuditContext`（apps/macos/Tono/Services/AppState.swift）发布新 ResidentialRouteAuditContext 并更新 assistant 直连首选成员后，仅调用
`restartConnectionsStreamAfterRuntimeChange`。logs 流的 250 ms 合并缓冲与在途 receive 延续到新上下文，而 `recordCoreLogs` 不做代际校验
（连接流的 `residentialContext == residentialRouteContext` 护栏只覆盖 `recordConnections`），旧路由行按新首选成员走
`managedDirectGroupThatFellBack` 判定，`mihomo_route` 也会记入新 runtime 名下。修复：镜像连接流新增
`CoreWebSocket.restartLogsStreamAfterRuntimeChange`（仅在开启时丢弃缓冲与在途回调、按原 level 重建，关闭保持关闭），并在同一提交点调用。
