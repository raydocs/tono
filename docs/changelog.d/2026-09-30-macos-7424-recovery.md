## 2026-09-30 · macOS 7424 恢复路径续修
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1 / G3，macOS 原生更新释放和恢复。
- 来源：seq 7424 `3635fc93` 审计 → main `b9c50b60` 上独立分支 `fix/macos-7424-recovery-20260930`；尚未合 main。
- 缺陷修复：原生更新 Disconnect 响应或后置记账失败不再无依据承诺直连被阻断；按只读 helper wanted/live 回读显示已释放、在线阻断或未确认，拒绝迟到的代际结果。激活期间继续使用相同 live 判断。关联 M7424-native-disconnect-reading。
- 新增/优化：无；保留 fail-closed enforcement 和待完成更新证据，不把 PF 释放回读当作 Core/DNS 清理完成或更新事务退役。
- 工程与测试：每种行为一个 XCTest，注入 helper transport 与原有只读 health seam，实际 AppState release/task/UI 路径运行；红候选 `70fa658d`。不改变工作流或 native toolchain。
- 验证：MacBook `git diff --check` exit 0；hosted red/green 与独立高风险 diff 审查待执行。未运行本机 native build、TUN、PF 或实机故障注入。
- 候选/发布：仅源码，无新签名候选、无客户更新源变化；原 7424 包不含本修复。
- 剩余限制：死机的 kernel panic 根因未证明。辅助器紧急解除依赖坏账本、跨进程电源回调、解除前重新加载 PF 等审计项仍需后续修复；不声称客户机器恢复已验收。
