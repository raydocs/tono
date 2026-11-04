## 2026-11-03 · 桌面 0.0.82 / macOS build 83 发布准备（仅源码）
- 归属：G4 候选准备；影响 Windows 与 macOS 版本字段、发布说明、候选工作流 pin。
- 来源：基线 main `fcee73f48`（#1820 合并）→ 分支 `release-prep/desktop-0.0.82`。0.0.81（`dd38b3e9a`）构建过但未分发，本版替代 0.0.80 RC，并包含 0.0.81 之后合入的桌面改动：#1820、#1797、#1793、#1785、#1778、#1796、#1791、#1777、#1798、#1794、#1763。
- 缺陷修复：无（功能修复在上述 PR）。
- 新增/优化：版本 0.0.81 → 0.0.82（`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`project.pbxproj` MARKETING_VERSION），macOS build 82 → 83；`macos-release.yml` CANDIDATE_VERSION/BUILD、`windows-candidate.yml` 版本期望与制品名、`windows-installer-smoke.yml` 制品名、`test-windows-candidate-install.ps1` 守卫同步；发布说明 `apps/windows/release-notes/0.0.82.md/.zh.md`、`apps/macos/release-notes/build83.md/.zh.md`（含 0.0.81 内容，因为 0.0.81 没有发出）。
- 工程与测试：`macos-candidate-workflow.test.rb` 合成 fixture 改为 0.0.82/build83，过期用例改为 0.0.81/build82；`TrayPanel.test.tsx` 更新提示版本随之上调。
- 验证：`python3 tooling/scripts/verify-desktop-version.py --expected 0.0.82` PASS（六处一致）；`ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` 通过；其余见 PR CI。
- 候选/发布：合并后快进 `release/windows`、`release/macos`，以 `update_release_sequence` 8201 dispatch 两个 release workflow（macOS `candidate_only`），再发双端 RC 预发布。正式更新源不推进。
- 剩余限制：#1820 防泄漏规则未在真机实测；HOLD #1643、#1733 不包含；G1–G3 未验收。
