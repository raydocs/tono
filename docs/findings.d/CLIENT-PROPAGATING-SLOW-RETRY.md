| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CLIENT-PROPAGATING-SLOW-RETRY | 两端客户端丢掉 503 `EXIT_IDENTITY_PROPAGATING`：Windows 新设备最多约 5 分钟没有目录，macOS 无缓存时启动进入终止错误 | fixed(3c9f3923) | #1379 | 中·已确认 | 原生测试未在本机运行（托管 CI）；等待期间 macOS 只显示原有的恢复/登录进度，没有专门文案 |

Rust `tono-core/src/auth.rs` `map_status` 和 Swift `TonoAPIClient` 把这个 503 归为通用 server 错误，类型丢失。Windows `catalog_sync.rs`：登录后 4 次请求、间隔 1 秒，全部 503 后周期任务跳过立即那一拍，再等 300 秒。连接在目录为空时直接拒绝。macOS：无缓存时 `activateCloudFallback` 只请求 2 次，失败后 `fail()` 停掉周期任务并进入 `.error`，只能手动重试。

修复：两端只对 `503 + EXIT_IDENTITY_PROPAGATING` 保留类型。Windows 同一个周期任务在上一次同步以该原因结束时 15 秒后再请求目录（不另开循环，登出时随任务一起取消），1 秒重试不再对它重复。macOS 无缓存的启动保持原来的非就绪状态，每 15 秒再请求一次，最多 20 次；登出、恢复网络会取消等待，账户或状态变化后的旧结果不会被采用（决策 055）。回归：Rust `identity_propagating_schedules_the_next_catalog_request_within_30_s`，XCTest `testPropagatingIdentityWithoutACacheWaitsAndStartsOnALaterCatalog`。

2026-10-06 合入续记：[#1379](https://github.com/raydocs/tono/pull/1379) 以 `3c9f3923` 合入 main；精确 PR head 的 [ci-gate 37427128341](https://github.com/raydocs/tono/actions/runs/37427128341) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
