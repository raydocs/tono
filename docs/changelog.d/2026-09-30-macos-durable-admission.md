## 2026-09-30 · macOS 连接必须先持久化重启防循环记录
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1，R677-codex-F1 / #677 的续修。
- 来源：main `b9c50b60` → PR #686 `7ef29d00` 上堆叠分支 `fix/macos-durable-connect-admission-20260930`；未合 main，必须先合 #686。
- 缺陷修复：ENOSPC/I/O 错误不再被 boot-session 记录写入吞掉；Connect 在清保护显示、改 admission 代际、启动 privileged/network 工作前拒绝，保留先前持久记录、PF 意图及显示，暂停自动恢复。明确重试在同步成功后才能继续。
- 新增/优化：无；不通过放开 PF 来避免重启循环，不改 fail-closed 契约。
- 工程与测试：独立 XCTest 覆盖写失败传播、实际 AppState admission 拒绝、同步成功重试以及旧记录保留。红候选 `ecf131ce`；原持久化测试只补 throws 调用，不改断言。
- 验证：MacBook `git diff --check` exit 0；hosted red/green CI 和独立 Codex high 当前 diff review 待完成。本机未 native 编译/运行，未改系统网络。
- 候选/发布：仅源码，无新包、无客户更新源变化；7424 不含本续修。
- 剩余限制：防止记录没落盘却进入连接，不代表 PF/helper 自身不会在开机触发 panic；首次事故根因、helper 独立紧急解除和实机恢复仍未验证。

### 2026-09-30 续记 · 后置同步失败
- PR [#687](https://github.com/raydocs/tono/pull/687)，必须在 #686 后合。初次独立 Codex high 覆盖 `7ef29d00...4dd85bfa` 无 major、有一项 minor：rename 后目录同步失败会留下当前 boot 字节，同启动重开 App 可误解为记录成功。
- 红候选 `52c999fc` 增加发布后失败、丢失 preferences 的 relaunch 反例。同步当前 boot 记录前先写入并同步 pending marker；仅当前记录及目录同步成功后删除 marker。失败保留 marker，读取时自动恢复保持暂停，不把可见字节当持久化成功。
- 这是故障注入回归，不是物理磁盘故障/首次 panic 实机证明；最终 exact-head CI 与复核仍待完成。

### 2026-09-30 续记 · marker 清理不是第二个授权点
- `0d0842a4` 复核无 major、指出一个 minor：在 marker unlink 后再次目录同步失败，会拒绝已经成功持久化 guard 的连接，且 relaunch 看到 marker 已删时行为不一致。
- 删除这个冗余的后置失败点：记录及其目录必须先由真实 writeSynced 成功同步；marker 删除失败仍拒绝，成功删除后即完成 admission。marker 删除若没跨断电持久化，它重现只会使下一启动更保守地暂停，不能授权未持久化的连接。旧 preference 仍仅在 guard 同步成功后发布。
- 此续修与测试待新 exact-head CI 和局部 independent review，不沿用 `0d0842a4` 为改后证据。
