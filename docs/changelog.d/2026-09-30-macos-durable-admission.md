## 2026-09-30 · macOS 连接必须先持久化重启防循环记录
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1，R677-codex-F1 / #677 的续修。
- 来源：main `b9c50b60` → PR #686 `7ef29d00` 上堆叠分支 `fix/macos-durable-connect-admission-20260930`；未合 main，必须先合 #686。
- 缺陷修复：ENOSPC/I/O 错误不再被 boot-session 记录写入吞掉；Connect 在清保护显示、改 admission 代际、启动 privileged/network 工作前拒绝，保留先前持久记录、PF 意图及显示，暂停自动恢复。明确重试在同步成功后才能继续。
- 新增/优化：无；不通过放开 PF 来避免重启循环，不改 fail-closed 契约。
- 工程与测试：独立 XCTest 覆盖写失败传播、实际 AppState admission 拒绝、同步成功重试以及旧记录保留。红候选 `ecf131ce`；原持久化测试只补 throws 调用，不改断言。
- 验证：MacBook `git diff --check` exit 0；hosted red/green CI 和独立 Codex high 当前 diff review 待完成。本机未 native 编译/运行，未改系统网络。
- 候选/发布：仅源码，无新包、无客户更新源变化；7424 不含本续修。
- 剩余限制：防止记录没落盘却进入连接，不代表 PF/helper 自身不会在开机触发 panic；首次事故根因、helper 独立紧急解除和实机恢复仍未验证。
