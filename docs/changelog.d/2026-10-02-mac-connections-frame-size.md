## 2026-10-02 · macOS：连接数很多时「连接」数据流不再反复断开
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) §2 第 10 项。macOS App（`CoreWebSocket`）。
- 来源：基线 `f0568a88`；分支 `fix/mac-connections-frame-size`，[#1336](https://github.com/raydocs/tono/pull/1336)。未合 main。
- 缺陷修复：Core 的 `/connections` 把所有打开的连接放在一个 WebSocket 帧里。`URLSessionWebSocketTask` 收到超过 `maximumMessageSize`（默认 1 MiB）的帧时接收直接失败，`CoreWebSocket` 没有改过这个上限：连接有几千条时接收失败，2 秒后重连，拿到同样大的快照再失败，一直到连接数降下来。期间活动页的连接列表显示为过期，本地流量审计不记连接，同一个回调里的 DIRECT pins 刷新判断也不运行。现在三条数据流的上限是 16 MiB。不影响保护（PF、隧道都不依赖这条数据流）。
- 新增/优化：无。
- 工程与测试：`createTask` 由 private 改为 internal 供测试读取；一条 XCTest（`testAConnectionsSnapshotOfABusySessionFitsOneFrame`）。测试提交先单独推送，hosted CI 在旧代码上跑出失败。
- 验证：见 PR。本机没有原生构建。
- 候选/发布：仅源码，无新候选。
- 剩余限制：没有实测多少条连接会超过 1 MiB（每条几百字节，估计 1500–2500 条）；超过 16 MiB 的快照仍然同样失败；没有实机验证。
