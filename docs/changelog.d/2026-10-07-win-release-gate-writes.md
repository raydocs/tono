## 2026-10-07 · Windows 释放不再因修复锁的 ProgramData 写失败被拒（R681-release-gate-writes）
- 归属：docs/SHIP_PLAN.md §2 item 10（0.0.75 修复批，老板 2026-10-07）；`apps/windows/service` IPC 生命周期入口。同一缺陷即 BRICK-W5「仍未修」第一项。
- 来源：main `f2cb79522` → 本 PR（分支 `claude/win-release-admission-before-repair-gate-20261007`）；未合 main。
- 缺陷修复：`enter_owner_lifecycle`（`core/server/mod.rs`）对每条路由先取 `acquire_service_repair_gate()`，它会准备 `ProgramData\Tono` 与 `bin`（重设私有 DACL）并创建/锁 `.repair.lock`；任一 I/O 或 ACL 写失败时 `ReleaseKillSwitch` 也被拒，已武装的机器断开不了（fail-closed，无泄漏）。改后：新函数 `owner_lifecycle_repair_gate` 决定修复锁结论——锁被其他进程持有（安装程序在跑）仍拒绝所有路由；取锁 I/O/ACL 出错时，只有 `ReleaseKillSwitch` 记警告后不带锁继续，接着照旧走只读 `release_admission()`（更新存储只读、手动租约、BRICK-W5 d 规则不变）和 `authorize_write_for`（未改，H2-F2 不变）；其他路由照旧以真实原因拒绝。与 SCM 停止、放弃的 Connect 清理已用的 H-IPC-2 判断一致（I/O 错误不证明有安装程序）。
- 新增/优化：无。
- 工程与测试：一条 `#[test] release_reaches_admission_when_the_repair_gate_cannot_be_prepared`（`core/server/owner_lifecycle_tests.rs`）：取锁失败时 Release 得到「无锁继续」，非 Release 路由仍拒绝，锁被持有时 Release 仍拒绝。旧代码没有该判断函数，取锁失败一律拒绝。
- 验证：MacBook 不跑 cargo（老板规则）；证明是本 PR 精确 head 上的 `ci-gate`（Windows Service `cargo test`）。未实机复现 ProgramData ACL 写失败。
- 候选/发布：无新包，仅源码。
- 剩余限制：取锁失败时 Release 不持修复锁，与同时启动的安装程序之间只靠更新存储里的证据（租约/挂起记录）排队，与 SCM 停止路径相同；释放路径仍会尝试一次 DACL 重设（不再因失败被拒），没有拆出只读锁。BRICK-W5 其余项（管理员释放路由 a/b、另一用户已登出 c、BRICK-W10）不变；未实机。
