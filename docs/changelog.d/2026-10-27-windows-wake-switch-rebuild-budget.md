## 2026-10-27 · Windows：切换中被让出的事件重建不再占用每小时名额
- 归属：G1（Connected = 可用：唤醒/换网后的恢复）；`apps/windows/app/src-tauri` 连接监视器。
- 来源：`main` df0c0322a → 分支 `fix/windows-wake-switch-rebuild-budget`；未合 main。与 #1780（只加测试、记录 WIN-WAKE-SWITCH-DEFERRED-REBUILD）并行，不改同一文件。
- 缺陷修复：WIN-WAKE-SWITCH-DEFERRED-REBUILD。唤醒等网络事件的两次探测失败恰逢节点切换未完成时，原来先记入每小时 3 次事件重建名额、标记线路不稳并把失败计数清零，再由 `capture_health_context` 把重建让给切换（实际什么都没做）；之后要等 30 s 周期探测。改后：切换进行中的这次重建不记名额、不标不稳，失败计数停在差一次的位置，下一拍继续探测，切换结束后再失败一次立即在名额内重建。
- 新增/优化：无。保护（WFP）与切换所有权不变：重建仍只在切换结束后发生。
- 验证：见 PR 验证评论（`cargo test` 由 hosted Windows CI 跑，本机不跑）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未在 Windows 实机睡眠/唤醒中复现；切换进行中每 2 s 拍会重复数据面探测，直到切换结束或探测通过。
