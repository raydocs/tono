## 2026-09-26 · 0.0.73 发布范围决定、批次回归审查区间

- 归属：G1–G4（发布范围）与 ops（记录）；无代码改动。
- 来源：基线 origin/main；分支 `docs/release-decisions-20260926`。
- 决定（`docs/DECISIONS.md`）：测试包可用生产 v1 更新指针（owner）；agent 可自审批测试包的 `windows-release` 签名（owner）；#331 不挡 0.0.73，H1-F5 macOS 一半作为已知限制（owner）；#352 不进 0.0.73 测试包，等 Win11 `icacls` 证据后进 0.0.74，H2-F3 作为已知限制（provisional）。
- 合并回归审查：区间 `3470dd68...f15e95a7`（#645–#654、#642、#643），jev-route triple（opus + codex + grok）run `587e5268`：1 major = F520-1 残留（由 `fix/win-stale-protected-status-20260926` 修复，合入后此区间才算通过），4 minor 均为已登记的 R643-F1 / R643-F2 同类（`settlePFEnableAcquire` 补入 R643-F1）。
- 发布前阻断核查：astra6 全量分诊 + Opus 交叉核实，确认 H22-O-F1（BFE 停止时无法安装，09-22 回归）与 H22-O-F2（缺 VC++ 运行库时安装门禁无法启动，已用 fb5e8485 候选包导入表核实）为 major，修复分支 `fix/win-install-bfe-crt-20260926`；H4-F3 生产未配置 `OPS_ROLES`，不阻断。
- 验证：无（仅文档）。
- 候选/发布：无新包。
- 剩余限制：H20-O / H22-O 其余 16 条原文丢失，未能完整排除。
