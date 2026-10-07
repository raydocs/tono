## 2026-10-07 · Windows 释放不再因修复锁的 ProgramData 写失败被拒（R681-release-gate-writes）
- 归属：docs/SHIP_PLAN.md §2 item 10（0.0.75 修复批，老板 2026-10-07）；`apps/windows/service` IPC 生命周期入口。同一缺陷即 BRICK-W5「仍未修」第一项。
- 来源：main `f2cb79522` → 本 PR（分支 `claude/win-release-admission-before-repair-gate-20261007`）；未合 main。
- 缺陷修复：`enter_owner_lifecycle`（`core/server/mod.rs`）对每条路由先取 `acquire_service_repair_gate()`，它会准备 `ProgramData\Tono` 与 `bin`（重设私有 DACL）并创建/锁 `.repair.lock`；任一 I/O 或 ACL 写失败时 `ReleaseKillSwitch` 也被拒，已武装的机器断开不了（fail-closed，无泄漏）。改后：新函数 `owner_lifecycle_repair_gate` 决定修复锁结论——锁被其他进程持有（安装程序在跑）仍拒绝所有路由；取锁 I/O/ACL 出错时，只有 `ReleaseKillSwitch` 改用新 `probe_service_repair_gate()`（`core/repair.rs`：只打开已有 `.repair.lock` 并加锁，不准备目录、不重设 DACL、不创建文件）——探测到被持有仍拒绝，探测拿到锁就带锁继续，探测也打不开或锁不上才记警告后不带锁继续；之后照旧走只读 `release_admission()`（更新存储只读、手动租约、BRICK-W5 d 规则不变）和 `authorize_write_for`（未改，H2-F2 不变）；其他路由照旧以真实原因拒绝。最后一步与 SCM 停止、放弃的 Connect 清理已用的 H-IPC-2 判断一致（I/O 错误不证明有安装程序，但也不证明没有）。
- 新增/优化：无。
- 工程与测试：一条 `#[test] release_reaches_admission_when_the_repair_gate_cannot_be_prepared`（`core/server/owner_lifecycle_tests.rs`）：取锁失败且探测失败时 Release 得到「无锁继续」，探测拿到锁时带锁继续，探测到被持有时仍拒绝；非 Release 路由取锁失败仍拒绝；锁被持有时 Release 仍拒绝。旧代码没有该判断函数，取锁失败一律拒绝。
- 验证：MacBook 不跑 cargo（老板规则）；证明是本 PR 精确 head 上的 `ci-gate`（Windows Service `cargo test`）。未实机复现 ProgramData ACL 写失败。
- 候选/发布：无新包，仅源码。
- 剩余限制：取锁与探测都失败时 Release 不持修复锁，只靠更新存储里的证据（挂起记录、手动租约）挡安装程序；`tono-service-install.exe` 无参数的直接修复不写租约，这一窄窗口里与它没有互斥（与 SCM 停止路径相同）。释放路径仍会先尝试一次 DACL 重设（失败不再拒绝）。
- 续记 2026-10-07：jev-route 评审 `8c796cb9`（opus + codex，high）PASSED，0 阻断；两条 minor 一轮修复：codex:F1（取锁失败与安装程序持锁可同时成立）→ 加只读探测；opus:F1（finding 片段剩余限制过时）→ 已更新。BRICK-W5 其余项（管理员释放路由 a/b、另一用户已登出 c、BRICK-W10）不变；未实机。
