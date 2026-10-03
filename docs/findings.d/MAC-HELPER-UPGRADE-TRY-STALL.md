| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HELPER-UPGRADE-TRY-STALL | 静默 helper 升级的 `/helper/upgrade` 请求在 connect/socket/发送失败（从未送达 helper）时被 `try?` 吞掉，仍进入 45 秒版本轮询，连接准备路径空等 45 秒才回退 | fixed(bbadfc1b) | [#759](https://github.com/raydocs/tono/pull/759) | 中·推导 | 修复：`attemptSilentUpgrade` 改为按错误分类，`.socketFailed`/`.connectFailed`/`.boundToAnotherUser` 立即返回 false 并记 `helper_silent_upgrade_failed`；回复丢失（`.emptyResponse`/`.invalidResponse`）保留原有轮询，未知错误默认保留。未实机复现（需 helper 在版本探测后、升级 POST 前不可达）；未编译未跑 XCTest（本机无 Swift），hosted CI 待跑。回复真丢失时仍等满 45 秒，有意保留。 |

来源：2026-09-30 读码发现（`apps/macos/Tono/Core/HelperManager.swift` `attemptSilentUpgrade` 的 `try? sendRequest`，
`sendRequest` 只抛 `HelperIPCError`；helper 侧 `SocketServer.swift` `/helper/upgrade` 先回 200 再退出，`HelperHTTP.swift`
`readRequest` 按精确 Content-Length 匹配、不足即 400，故部分写入不可能触发升级）。回归测试
`HelperSilentUpgradeTimeoutTests.testUpgradeRequestThatNeverReachedHelperSkipsSilentUpgradePoll`。记录见
[changelog](../changelog.d/2026-09-30-macos-helper-upgrade-no-stall.md)。
