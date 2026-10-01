## 2026-10-01 · macOS menu bar no longer shows Protected Offline over a released host
- 归属：SHIP_PLAN §2 item 10；macOS 菜单栏状态。
- 来源：origin/main 509ebde2；分支 claude/r4-mac-paused-status；源码 PR，未合 main。
- 缺陷修复：MAC-PAUSED-OPEN-STATUS。第三次 supervisor repair 释放网络（保留 AI 拦截）后设置用户暂停，菜单栏仍显示「Protected Offline · retries paused」。暂停分支现在要求 `isProtectionBlocked`。
- 新增/优化：无。
- 工程与测试：新增 `PausedAfterReleaseStatusTests` 一条，走真实 core monitor 第三次 repair 路径，断言释放后菜单栏不是 `.blocked`；旧代码返回 `.blocked`（按代码推理，未实跑）。
- 验证：本机不运行 xcodebuild（所有者规则）；以 hosted CI macOS TonoTests 为准。
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：无真机项。
