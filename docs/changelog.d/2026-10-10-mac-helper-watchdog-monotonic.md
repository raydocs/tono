## 2026-10-10 · macOS helper 空闲检查改用单调时钟（MAC-HELPER-WATCHDOG-WALLCLOCK）
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)；所有者要求的 helper 挂起/死锁/永久断网审计）；macOS 特权 helper `tooling/scripts/core-helper/`。
- 来源：基线 origin/main 598ece8c；分支 `amp/helper-watchdog-monotonic`；未合 main。
- 缺陷修复：`SocketServer.run` 用 `Date().timeIntervalSince(lastProtectionCheck) >= 10` 决定是否跑保护检查。墙钟往回拨 N 秒后，差值在 N 秒内都是负数，
  这段时间里 Core 已停的拦截释放（约 30 s 门槛）、孤儿 bootstrap/隧道会话释放、PF 监督、App 拉起都不跑；Core 死掉、App 不在时，
  断网时长等于回拨长度。改为 `ProtectionCheckSchedule`：`CLOCK_MONOTONIC`（含睡眠，不会被拨动）计 10 s，读数倒退也立即到期。
- 新增/优化：无。检查的内容、顺序和 10 s 间隔不变；睡眠后醒来仍立即到期（单调时钟含睡眠时间）。
- 工程与测试：helper `--self-test` 新增 `ProtectionCheckSchedule.runClockStepSelfTest`（9 s 不到期、10 s 到期；读数回拨一小时立即到期，其后按 10 s 继续）。
  helper 4.52.44 → 4.52.45，`CONTRACT.sha256` 按 `build-core-helper.sh` 的算法重算。
- 验证：Linux orb：`sh tooling/scripts/test-core-helper-contract-guard.sh` → `PASS build-core-helper contract guard`；
  `python3 apps/macos/scripts/test_build_source.py` → `OK`。Swift 编译与 `--self-test` 由托管 macOS CI 执行，本机未执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未在真机上改系统时间复现；`KillSwitchManager.runBoundedSystemLookup` 的 3 s 期限仍用墙钟。
