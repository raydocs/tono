## 2026-09-30 · macOS 静默 helper 升级请求未送达时不再空等 45 秒
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 应用与 helper IPC。
- 来源：main `01c2403f` → 分支 `glm/mac-helper-upgrade-stall`；PR 待开；未合 main。
- 缺陷修复：`attemptSilentUpgrade` 用 `try?` 发 `/helper/upgrade`，connect/socket/发送失败也被吞掉，`response` 为 nil 后照样进入 `silentUpgradePollTimeout`（45 秒）的版本轮询——为一个从未送达 helper 的升级空等 45 秒，`installIfNeeded` 所在的连接准备路径整体卡住才回退。现在按错误分类：`.socketFailed`、`.connectFailed`、`.boundToAnotherUser`（请求可证明没有完整送达；helper 只在读完整个请求体后才升级，见 `HelperHTTP.swift` `readRequest` 的精确 Content-Length 匹配）立即返回 false 并记 `helper_silent_upgrade_failed`；回复丢失（`.emptyResponse`、`.invalidResponse`）仍可能升级在途，保留原有轮询。未知错误类型默认保留轮询，不放宽原行为。
- 新增/优化：无。`sendRequest` 对其他路径的行为未改。
- 工程与测试：新增纯谓词 `HelperManager.upgradeRequestMayHaveBeenDelivered(_:)` 与一条 XCTest（`HelperSilentUpgradeTimeoutTests`）；`HelperProtocolVersion`、`CONTRACT.sha256` 未动。
- 验证：本机 Linux 无 Swift/Xcode，XCTest 未编译未跑；hosted CI 待跑。修复前行为与 helper 侧「先回 200 再退出」均已读码确认（`SocketServer.swift` `/helper/upgrade`）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机复现（需要 helper 在版本探测后、升级 POST 前死掉或 socket 不可连接的场景）。回复真丢失时仍按原设计等满 45 秒，这是有意保留。见 [MAC-HELPER-UPGRADE-TRY-STALL](../findings.d/MAC-HELPER-UPGRADE-TRY-STALL.md)。
