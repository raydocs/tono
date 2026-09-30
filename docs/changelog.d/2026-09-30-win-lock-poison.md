## 2026-09-30 · Windows 隧道 lock 从毒锁恢复
- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；Windows 服务 `windows_kill_switch` 的隧道 lock。
- 来源：main `ff81118a` → 分支 `hunt/grok-wfp-lock-poison-d8c1`；未合 main。
- 缺陷修复：`lock_unlocked` 用 `ARMED.lock().unwrap()`。持锁期间一旦 panic，互斥量中毒，之后每次隧道 lock 都在 IPC 任务里 panic，直到服务进程重启才能再锁。改为 `armed_guard()`，与模块既有毒锁恢复约定一致。关联 `WIN-LOCK-POISON`。`mark_verified` 的同类问题由 #753 覆盖，本条目不重复修。
- 新增/优化：无。
- 工程与测试：新增 `lock_recovers_a_poisoned_armed_lock`。
- 验证：Linux，`cargo +1.98.1 test --locked --features standalone,client,test --lib lock_recovers_a_poisoned_armed_lock`。修复前失败：`windows_kill_switch.rs:1712` `called Result::unwrap() on an Err value: PoisonError`。修复后 `ok. 1 passed`。未做实机 WFP。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`。不能声称客户包已含此修复。毒锁仍以持锁期间发生过 panic 为前提。
