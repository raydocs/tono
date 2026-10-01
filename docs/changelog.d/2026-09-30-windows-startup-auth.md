## 2026-09-30 · Windows startup restore respects interactive sign-in
- 归属：SHIP_PLAN §2 item 10；Windows 启动/账户可靠性。
- 来源：基线 `20ce5d1a`；分支 `hunt/sol-r3acct-startup-auth`，PR 待开；仅源码。
- 缺陷修复：慢启动 pins/Adopt 后的恢复不再抢占已经开始的登录。启动只认初始认证代数；Adopt 前保留所有权、后重查，显式 Retry 保留新事务入口。
- 新增/优化：无；被交互登录取代的启动仍执行独立更新 Adopt，原恢复/保护轮询继续存在。
- 工程与测试：一个带 Adopt 屏障的认证顺序回归，实际 Tauri 测试使用 TonoState::for_test 和 begin_sign_in。
- 验证：Linux 精确生产辅助函数及同一测试的轻量状态夹具，基线 0 passed / 1 failed，修复 1 passed / 0 failed；git diff --check 通过。完整 Tauri/Windows 状态测试本机未执行，由 CI 验证。
- 候选/发布：仅源码，无新包、部署或发布。
- 剩余限制：非完整 Linux Tauri 测试；不改 WFP、DNS、严格模式或更新协议。
