## 2026-09-30 · Windows：Mihomo WebSocket 连接按请求超时停下

- 归属：编排器低风险范围 A13（tono-plugin-core）。不是客户发布门。不改路由、TUN 或 WFP。
- 来源：基线 `origin/main` `ff81118a`；分支 `cursor/mihomo-ws-connect-timeout-5636`（从云代理 bc-7ab08cd1 的本地提交 `f79b67a8c` 恢复）。
- 缺陷修复：HTTP 请求有 `request_timeout`，`connect_async` / `client_async` 没有。对端收下 TCP 但不完成握手时，日志和连接的 WebSocket 会一直等。改后用同一请求超时，超时即返回 `Error::Timeout`，不挂起调用方。
- 新增/优化：无。不自动重连。
- 工程与测试：`http_websocket_connect_times_out_when_the_handshake_never_finishes`。
- 验证：在 `apps/windows/crates/tono-plugin-core` 下 `cargo test --lib http_websocket_connect_times_out` 通过（1 项），`cargo test --lib` 42 项通过、1 项忽略（Linux 盒子）。去掉 `connect_async` 的超时后该用例挂住（60 秒被杀）。本地套接字（命名管道）路径需 Windows 真机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：握手完成后的读循环仍没有空闲超时；断线不重连。
