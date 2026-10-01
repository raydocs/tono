## 2026-09-30 · macOS 可选 DIRECT 策略在替换 Core 前失败不再拆掉正常连接
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1，§2 第 10 条（装上会坏）；macOS AppState 可选策略后台替换。
- 来源：main `c0a44053` → 分支 `codex2/mac-optional-policy-fail-open`；PR #778；未合 main。
- 缺陷修复：MAC-OPTIONAL-POLICY-FAIL-CLOSED。旧 catch 把"首次 PF arm / 写运行配置失败"（Core 尚未被触碰）与"Core 替换失败"一律当成会话故障，preserve 断开一个正常工作的连接（bootstrap-only PF + protected reconnect）。现在在 `/core/sync` 前记录替换开始；在此之前失败时，按 Connect 已连接 arm 的参数重装原 `activeDirectPolicy` 的 PF 会话例外，保留 Core/TUN 与连接，只显示错误文案。替换开始后失败、或 PF 重装失败，保持 main 原有行为（preserve 断开 + protected reconnect）不变。取消、断开和代际 guard 保留。
- 新增/优化：无。
- 工程与测试：`OptionalPolicyTests.swift` 新增一条纯判定 XCTest（替换前 keepSession / 替换后 teardown）；现有后台失败回归（接缝模拟替换后失败）不变并继续通过。
- 验证：Linux 静态复核调用链及 Swift diff；`git diff --check` 通过。无 Swift/Xcode；未编译、未跑 XCTest，待 hosted macOS CI 执行；未实机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Needs real-hardware test (静杰 batch)。替换开始后失败仍走现有 preserve + protected reconnect 合同，未改。
