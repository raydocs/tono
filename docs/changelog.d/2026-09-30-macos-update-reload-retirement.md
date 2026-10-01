## 2026-09-30 · macOS native update retires cancelled reload state
- 归属：SHIP_PLAN §2 item 10；macOS update reliability.
- 来源：baseline `e504f6f4`；branch `hunt/sol-r3mac-update-reload-retirement`，未合 main。
- 缺陷修复：更新取消重载后留下已结束的任务句柄，失败更新退役后阻挡节点选择和后续重载；现在等完旧任务后清除句柄，并提前退休旧完成回调和排队重载。关联 MAC-UPDATE-CANCELLED-RELOAD。
- 新增/优化：无；辅助程序和 PF/DNS/AI 规则无变更。
- 工程与测试：一个窄 XCTest 驱动实际 suspension，验证等待旧任务、清除重载状态及恢复正常节点选择验证。
- 验证：Linux 无 Swift / Xcode，未编译或执行 XCTest；交给 hosted macOS CI。`git diff --check` 本地通过。
- 候选/发布：仅源码，无新候选，未部署或发布。
- 剩余限制：P2 在途重载加失败更新路径；未实机验证。普通 Disconnect 或重启 App 原本也能恢复。
