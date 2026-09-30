## 2026-09-30 · macOS WebSocket 接收失败及时标记观测停滞
- 归属：SHIP_PLAN G1；macOS Core WebSocket 流量与连接观测。
- 来源：main `846705c7` → 分支 `codex2/mac-websocket-stall`；PR 待开；未合 main。
- 缺陷修复：已建立的流量或连接流接收失败后，只清空 socket 并重连；看门狗跳过空 socket，而每次重连重置时间戳，旧速率与连接快照可能一直显示为实时。现在在接收失败分支调用既有 `markStreamStalled`，再清空 socket、调度重连；成功接收沿用既有 `markStreamRecovered` 恢复实时标记。关联 `MAC-CORE-WS-STALE-LIVE`。
- 新增/优化：无。
- 工程与测试：未新增 XCTest；`TonoTests` 没有 `CoreWebSocket` 测试，session 内部构造，接收回调与 socket 均为私有，没有现成的故障注入点；按本任务允许的例外保留最小改动。
- 验证：Linux 工作树基于 `846705c7`；`git diff --check` 通过，逐行复核 Swift 改动及调用方。无 Swift/Xcode/Windows 工具链，未编译、未运行 XCTest 或 Windows 检查；托管 macOS CI 待跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：仅修复观测实时标记；日志流接收失败也未标记停滞，未在本次扩展处理；没有运行时故障注入验证。
