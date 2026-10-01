## 2026-09-30 · Windows watchdog timeout 绑定原 Core 身份
- 归属：SHIP_PLAN §2 第 10 项；Windows Service Core timeout cleanup。
- 来源：基线 `1fb29265`（含 #994/#999）→ 本 PR；分支 `hunt/sol-r3proc-watchdog-identity`，尚未合 main。
- 缺陷修复：abort 关闭原 Job/Child 后按裸 PID 终止 → 使用原 handle 仍持有时既有查询产生的内存 identity，重开 handle 验证 image/creation 后才终止；WIN-WATCHDOG-ABORT-PID-REUSE（P2）。
- 新增/优化：无新功能/磁盘读取/额外身份查询；磁盘 record write 失败也保留已查询 identity，未知身份不授权终止。AI/strict/WFP 规则未变。
- 工程与测试：一个真实 timeout/真实子进程的合成 stale creation 回归，先写再修。
- 验证：Linux VM，CARGO_BUILD_JOBS=2；新回归原实现 0 passed / 1 failed，修复 manager suite 6 passed / 0 failed；Windows GNU cargo check --lib --tests 通过；git diff --check 通过。额外 crash-loop integration 在修复与 unmodified baseline 均 HTTP 400 fixture 失败、未 spawn Core（0 passed / 1 failed），保持原测试不动。
- 候选/发布：仅源码，无新候选、无部署或发布。
- 剩余限制：托管 Windows CI 与 needs-hardware；实际 Windows PID 复用未重现，不能把 GNU cross-check 当原生运行。
