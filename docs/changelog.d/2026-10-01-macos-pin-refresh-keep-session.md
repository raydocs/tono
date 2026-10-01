## 2026-10-01 · macOS 钉选刷新失败不再拆掉会话

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；macOS 已连接会话的后台钉选刷新。
- 来源：main `e69db58d` → 分支 `cursor/r3-pin-refresh-keep-session-89a9`；PR 待开；未合 main。
- 缺陷修复：无网页后缀的策略仍会定期刷新精确钉。刷新在 Mihomo 接受新钉之前失败（helper 拒绝武装、写配置、同步或重载）时，`0a91a921` 起走 `disconnect(releaseKillSwitch: false)`，PF 收到 bootstrap，普通互联网被切断，直到保护重连。现在这次失败只记 `managed_direct_refresh_failed` 并结束这次事务，会话和已生效的 PF 保持；排在后面的重载不会被丢掉。关联 MAC-PIN-REFRESH-TEARDOWN。
- 新增/优化：无。钉已经提交之后 PF 无法从旧∪新收口，或提交后被取消，仍拆会话并安排立即重连。显式严格阻断不在这条路径上。带网页后缀的策略本来就不跑这次刷新。
- 工程与测试：`PinRefreshKeepSessionTests.testPinsOnlyRefreshFailureBeforeCommitKeepsTheSession`。helper 准备直接失败，断开用的特权调用换成空操作，避免回归时真的去拨 helper。
- 验证：Linux 工作树对照 `git show 0a91a921` 的删除分支和当前 catch。无 Swift/Xcode，未编译、未运行 XCTest；hosted macOS CI 待运行。Windows 不涉及。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络行为变更，needs-hardware。重连仍会在钉已提交后的收口失败时保持整机阻断。目录删掉当前出口、已连接时策略更新，仍是书面失败关闭，本次不改。
