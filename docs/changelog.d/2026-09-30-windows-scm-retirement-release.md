## 2026-09-30 · Windows Service Stop 记账失败仍完成已证明的释放
- 归属：SHIP_PLAN §2 item 10；Windows DNS / WFP 恢复组合复核。
- 来源：origin/main `89a0e0e7` → 分支 `hunt/sol-r4dns-scm-retire-release`；待 PR / 合入。
- 缺陷修复：DNS 已恢复且 Core 已停止时，owner 状态写失败不再跳过 WFP 释放，避免 SCM Stop 留下整网阻断；严格模式和自动 AI 保留沿用既有释放逻辑。
- 新增/优化：无。
- 工程与测试：一项窄回归覆盖退休写错误边界与真实 WFP facade，核实 wanted:false 和 AI hold。初始 fixture 缺少 proxy endpoint，已纠正；该 fixture 失败不计客户缺陷。
- 验证：Linux、CARGO_BUILD_JOBS=2，回归在原提前返回逻辑下失败，修复后通过；WFP 与 server 测试见 PR。Windows 原生 SCM / WFP / DNS 未执行。
- 候选/发布：仅源码，无新候选、无部署或发布。
- 剩余限制：原生服务停止和文件共享拒绝需实机验收；DNS 证明或 Core 停止失败仍沿原策略处理。
