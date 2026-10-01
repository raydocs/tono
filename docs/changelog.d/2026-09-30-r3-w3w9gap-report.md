## 2026-09-30 · R3 W3/W9 process / uninstall 审查交接
- 归属：SHIP_PLAN §2 第 10 项；Windows Service Core process/proxy 与 uninstall/legacy/NSIS。
- 来源：本报告 PR，分支 hunt/sol-r3proc-report；源码修复在 #994/#999/#1004/#1012/#1022，本 PR 仅文档。
- 缺陷修复：不新增产品修复；记录五个修复 PR 的六项 P2，并公开一个未修的 WIN-CORE-JOB-SPAWN-WINDOW（P2），避免下一猎手重复审查。
- 新增/优化：审查报告 29 假设，18 假阳性、4 重复、6 已修、1 未修；AI/strict/DNS/WFP 产品规则不变。
- 工程与测试：汇总各修复原始 baseline-fail/fixed-pass、Windows GNU cross-check 和 CI 证据；报告无新产品测试，不把继承证据当本报告 SHA 测试。
- 验证：records findings parser、git diff --check；先前 #1012 的 crash-loop integration 在 patch 与 unmodified baseline 都 HTTP 400 fixture 失败，未改/skip 测试。四个修复已合；#1022 在报告时原生 Service/core/app 通过，app-rust/aggregate pending。
- 候选/发布：仅审查文档，无新候选、无部署或发布。
- 剩余限制：atomic Job-at-creation launcher / native 回归未完成；最终 Windows 实机 acceptance 仍待验。未宣称实际 PID 复用或永久断网重现。
