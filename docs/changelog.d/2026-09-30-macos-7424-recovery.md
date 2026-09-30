## 2026-09-30 · macOS 7424 恢复路径续修
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1 / G3，macOS 原生更新释放和恢复。
- 来源：seq 7424 `3635fc93` 审计 → main `b9c50b60` 上独立分支 `fix/macos-7424-recovery-20260930`；尚未合 main。
- 缺陷修复：原生更新 Disconnect 响应或后置记账失败不再无依据承诺直连被阻断；按只读 helper wanted/live 回读显示已释放、在线阻断或未确认，拒绝迟到的代际结果。激活期间继续使用相同 live 判断。关联 M7424-native-disconnect-reading。
- 新增/优化：无；保留 fail-closed enforcement 和待完成更新证据，不把 PF 释放回读当作 Core/DNS 清理完成或更新事务退役。
- 工程与测试：每种行为一个 XCTest，注入 helper transport 与原有只读 health seam，实际 AppState release/task/UI 路径运行；红候选 `70fa658d`。不改变工作流或 native toolchain。
- 验证：MacBook `git diff --check` exit 0；hosted red/green 与独立高风险 diff 审查待执行。未运行本机 native build、TUN、PF 或实机故障注入。
- 候选/发布：仅源码，无新签名候选、无客户更新源变化；原 7424 包不含本修复。
- 剩余限制：死机的 kernel panic 根因未证明。辅助器紧急解除依赖坏账本、跨进程电源回调、解除前重新加载 PF 等审计项仍需后续修复；不声称客户机器恢复已验收。

### 2026-09-30 续记 · 评审纠正
- PR [#686](https://github.com/raydocs/tono/pull/686)。红 CI [36678056461](https://github.com/raydocs/tono/actions/runs/36678056461) 实际 checkout `70fa658d`，453 XCTest 中新增 native Disconnect 回归产生 14 条失败断言；其余行为未新增失败（已有 1 skip）。
- 独立 Codex `gpt-6-sol/high` 对 `7ef29d00` **未通过**：指出已验证释放没有使激活旧读回失效，以及启动恢复只设 RuntimeCleanup pending 时遗漏 live 判断。新增两条实际交错/启动入口回归，红候选 `85a20c96`；修复只扩展 pending 判定并在验证释放发布时推进 verdict sequence。未把首次审查改记为通过。
- 最终 exact-head hosted CI / 独立复核仍待完成；未合 main、未新包、未发布。
