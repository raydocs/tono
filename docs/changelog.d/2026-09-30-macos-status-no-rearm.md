## 2026-09-30 · 更新准备期间 status 不再重装阻断
- 归属：SHIP_PLAN §2 第 10 条（装上会坏）。macOS helper。
- 来源：基线 main `d2363002`；分支 `cursor/macos-status-no-rearm-581a`；[#710](https://github.com/raydocs/tono/pull/710)。尚未合 main。不包含 #701。
- 缺陷修复：
  - `/killswitch/status` 不再加载 PF 规则，也不在状态损坏时装紧急全阻断。更新准备在停掉 Core 之后读这个接口，旧行为会把阻断装回去。
  - 空闲监督只在 Core 正在运行时重装。Core 已停时只收紧 reviewed-bundle 许可（#608）。
  - BRICK-M11：helper 还在跑时删掉 App，约每 10 秒走已有的删除释放，不再等到下次启动。
- 新增/优化：无。
- 工程与测试：helper 在合并链上为 `4.52.3` → `4.52.4`（本 PR 只升一号）。`--self-test` 断言 Core 在跑才允许重装。`CONTRACT.sha256` 重算。
- 验证：Linux 无 Swift、无 PF。未编译、未跑 self-test。
- 候选/发布：仅源码，无新候选。
- 剩余限制：helper 自身卡在不可中断睡眠时，没有外部看门狗（见 MAC-HELPER-HANG-WATCHDOG）。版本行与 #701、#708、#712 冲突。未实机。

## 2026-09-30 · 启动不再从状态文件重装阻断（续）

- 归属：SHIP_PLAN §2 第 10 条。同一 PR #710，不新建条目。
- 缺陷修复：`restoreAtLaunch` 不再从状态文件装 PF，失败时也不再装紧急全阻断。helper 启动、Core 构造函数停掉残留进程之后：Core 不在且状态文件还在，立刻 `disarm`；Core 不在且有 DNS 快照，立刻恢复 DNS。Core 仍在跑则不装也不拆。与 #701 同一条规则，避免 #701 → #708 → #710 合并时把启动重装带回来。
- 新增/优化：无。
- 工程与测试：启动放行与 status 不重装同在 `4.52.4`，不再另跳一号。`--self-test` 仍断言启动放行与 DNS 恢复的条件。不改 `ProtectedDNSManager`。
- 验证：Linux 无 Swift、无 PF。未编译、未跑 self-test。
- 候选/发布：仅源码，无新候选。
- 剩余限制：与 #701 都会改 `restoreAtLaunch` 和 `SocketServer.run`。本分支已留一次放行，并保留 #701 的约 30 秒看门狗和 status 不重装、只在 Core 运行时监督、删除 App 时释放。需实机。
